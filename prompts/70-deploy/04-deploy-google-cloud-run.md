<!--
  robinhood-toolkit · build prompt: containerize and deploy to Google Cloud Run
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Deploy to Google Cloud Run

## Goal

Containerize the same `server/index.mjs` from prompt 03 and run it on Cloud Run:
request-billed, scale-to-zero, with a generous always-free tier. Deploy from a
Dockerfile rather than buildpacks, for a reason stated below.

## Prerequisites

- Prompt 03 completed. `server/index.mjs` exists and runs locally.
- A Google Cloud project with billing enabled. The free tier still requires a
  billing account.
- `gcloud` installed and authenticated: `gcloud auth login`, then
  `gcloud config set project <PROJECT_ID>`.
- Enable the APIs once: `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com`.

## Reference facts (verified)

- **Cloud Run has no static-only mode.** Every deployment is a container serving
  HTTP. There is no bucket-style hosting path here; the server is mandatory,
  which is exactly why prompt 03's server is the portable artifact.
- **Use a Dockerfile, not buildpacks.** Google Cloud buildpacks install
  production dependencies only. A Vite build needs devDependencies, so a
  buildpack deploy fails at build time with a missing-module error. A Dockerfile
  gives you explicit control of the install.
- `--set-env-vars` is **destructive**: it replaces the service's entire
  environment. Use `--update-env-vars` to change one key. This has cost people
  their whole config in one command.
- **Never set `PORT` yourself.** Cloud Run injects it and rejects a deployment
  that sets it explicitly. Read it, default to 8080.
- Listen on `0.0.0.0`. A container bound to `127.0.0.1` fails the startup probe
  and the revision never receives traffic.
- Always-free tier: 2,000,000 requests/month, 180,000 vCPU-seconds, 360,000
  GiB-seconds. These are counted **per billing account**, not per project. Ten
  projects under one billing account share one allowance.
- Whether GCP buildpacks honor `.nvmrc` is UNVERIFIED. Pin Node in the
  Dockerfile's base image tag, which is unambiguous.

## Steps

1. Write the `Dockerfile` at the repo root.

```dockerfile
# robinhood-toolkit · Cloud Run container
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.mjs"]
```

2. Note what this Dockerfile assumes: `dist/` is **already built** when the image
   is created. Run `npm run build` before `gcloud run deploy --source`, or add a
   builder stage that installs the full dependency set, runs the build, and
   copies only `dist/` into the runtime stage. Pick one and write it down; a
   half-built image serves a 404 for every page and looks like a routing bug.
3. Add `.gcloudignore` so the source upload stays small and never carries
   secrets:

```
# robinhood-toolkit · files excluded from the Cloud Run source upload
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
node_modules/
.git/
.env
.env.*
*.log
```

4. Deploy from source. Cloud Build detects the Dockerfile and builds it.

```sh
npm run build

gcloud run deploy robinhood-toolkit-site \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --concurrency 80
```

5. Set secrets through Secret Manager, not env vars. Env vars are visible to
   anyone with viewer access on the service.

```sh
echo -n "$RH_API_KEY" | gcloud secrets create rh-api-key --data-file=-

gcloud run services update robinhood-toolkit-site \
  --region us-central1 \
  --update-secrets=RH_API_KEY=rh-api-key:latest
```

6. Change a single non-secret variable without wiping the rest:

```sh
gcloud run services update robinhood-toolkit-site \
  --region us-central1 \
  --update-env-vars SITE_ORIGIN=https://example.com
```

7. Map a domain from the Cloud Run console, or put the service behind a global
   external HTTPS load balancer with a serverless NEG when you need a CDN in
   front of it.

## Deliverable

- `Dockerfile` exactly as above, or its multi-stage equivalent with the build
  step made explicit.
- `.gcloudignore` with the entries above.
- A `deploy/cloud-run.sh` wrapper carrying the shell attribution header and the
  full `gcloud run deploy` invocation, so nobody reconstructs the flags from
  memory.
- A `README.md` section listing the service name, region, secrets, and the
  rollback command.

## How to verify

```sh
# local container parity check, same entrypoint the platform will use
docker build -t rh-site .
docker run --rm -e PORT=8080 -p 8080:8080 rh-site
curl -s localhost:8080/api/healthz

# after deploy
URL=$(gcloud run services describe robinhood-toolkit-site \
  --region us-central1 --format='value(status.url)')
curl -s "$URL/api/healthz"

gcloud run services describe robinhood-toolkit-site --region us-central1 --format=yaml
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="robinhood-toolkit-site"' \
  --freshness=1h --limit=50
```

Rollback is a traffic split, and it is instant:

```sh
gcloud run services update-traffic robinhood-toolkit-site \
  --region us-central1 --to-revisions=<PREVIOUS_REVISION>=100
```

## Gotchas

- **`--set-env-vars` deletes every variable you did not name in that command.**
  Burn this in. `--update-env-vars` merges. The same distinction applies to
  `--set-secrets` versus `--update-secrets`.
- Setting `PORT` in the Dockerfile with `ENV PORT=8080` or passing
  `--set-env-vars PORT=8080` causes the deploy to be rejected. `EXPOSE 8080` is
  fine; it is documentation, not configuration.
- With `--min-instances 0`, the first request after idle pays a cold start. For a
  docs site that is acceptable. For anything latency-sensitive, set
  `--min-instances 1` and understand that you are then billed continuously and
  have left the free tier's shape.
- CPU is throttled to near zero outside a request unless you set
  `--cpu-boost` or always-on CPU. Background timers and in-process schedulers do
  not reliably run between requests. Use Cloud Scheduler hitting an endpoint.
- The free tier is per billing account. A second project does not grant a second
  allowance, and a surprise bill usually traces to that assumption.
- `--allow-unauthenticated` requires the `run.invoker` role on `allUsers`. In an
  org with a domain-restricted-sharing policy the flag silently fails to take
  effect and every request returns 403. Check the IAM policy on the service, not
  the deploy output.
- Concurrency defaults to 80 requests per instance. A synchronous CPU-heavy
  handler at that concurrency queues badly. Lower it if your handler is not
  mostly I/O-bound.
