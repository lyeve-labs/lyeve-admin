#!/usr/bin/env node
// Decide who owns this repository's git hooks, then get out of the way.
//
// The hooks in .husky/ run either way. What differs is who calls them.
//
// If core.hooksPath is already set, a hook manager owns the hooks and husky is
// not installed. Husky's installer writes .husky/_ into the repository's own
// config, and a repository value wins over a global one, so installing it
// would switch the manager off with no error. A manager that delegates to
// .husky/<hook> still runs commitlint and svelte-check. If nothing provides
// hooks, husky is installed as usual.

import { execFileSync } from 'node:child_process'

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// Not a git checkout (a tarball, or an npm install of the package). Nothing to do.
if (!git(['rev-parse', '--git-dir'])) {
  process.exit(0)
}

// Drop husky's own marker so the value read below is one set outside this
// repository rather than a leftover of the last install. A path someone chose
// deliberately is left alone.
if (git(['config', '--local', '--get', 'core.hooksPath']) === '.husky/_') {
  git(['config', '--local', '--unset', 'core.hooksPath'])
}

const provided = git(['config', '--get', 'core.hooksPath'])
if (provided) {
  console.log(`hooks: ${provided} is in charge, so husky is not installed here.`)
  process.exit(0)
}

execFileSync('npx', ['husky'], { stdio: 'inherit' })
