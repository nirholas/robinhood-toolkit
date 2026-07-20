# Attribution convention

Every source and documentation file in this repository carries an authorship
header. Keep it when you copy, fork, or vendor a file. The MIT license requires
the copyright notice be preserved in all copies or substantial portions.

## Markdown files

```markdown
<!--
  robinhood-toolkit · <short file purpose>
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->
```

## JavaScript / TypeScript / Solidity

```js
/**
 * robinhood-toolkit · <module name>
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
```

## Shell / YAML / TOML

```sh
# robinhood-toolkit · <file purpose>
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
```

## Verifying headers

```sh
npm run check:headers
```

Fails the build if any tracked source or doc file is missing its header.

## What this does and does not do

Headers make provenance obvious to anyone reading a file and make
attribution-stripping a visible, deliberate act rather than an accident. They do
not technically prevent copying. The enforceable protection is the MIT license
plus the public commit history on this repository. If you need stronger terms
than MIT for a derivative work, that is a licensing decision, not a header one.
