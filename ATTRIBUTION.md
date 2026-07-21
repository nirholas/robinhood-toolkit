<!-- built by nirholas x.com/nichxbt -->
# Attribution convention

Every source and documentation file in this repository carries an authorship
header. This software is proprietary and All Rights Reserved: keep the header
intact and do not copy, fork, or vendor a file without written permission.

## Markdown files

```markdown
<!--
  robinhood-toolkit · <short file purpose>
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->
```

## JavaScript / TypeScript / Solidity

```js
/**
 * robinhood-toolkit · <module name>
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
```

## Shell / YAML / TOML

```sh
# robinhood-toolkit · <file purpose>
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
```

## Verifying headers

```sh
npm run check:headers
```

Fails the build if any tracked source or doc file is missing its header.

## What this does and does not do

Headers make provenance obvious to anyone reading a file and make
attribution-stripping a visible, deliberate act rather than an accident. They do
not technically prevent copying. The enforceable protection is the All Rights
Reserved license in LICENSE plus the public commit history on this repository.
Any reuse of a derivative work requires the copyright holder's written consent.
<!-- built by nirholas x.com/nichxbt -->
