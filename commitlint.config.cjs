module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Keep the type set small and intentional.
    'type-enum': [
      2,
      'always',
      [
        'feat',     // new feature                  → minor bump
        'fix',      // bug fix                      → patch bump
        'perf',     // performance improvement      → patch bump
        'revert',   // revert a previous commit     → patch bump
        'deps',     // dependency update            → patch bump
        'refactor', // code change, no feat/fix     → no bump
        'docs',     // docs only                    → no bump
        'test',     // adding/updating tests        → no bump
        'build',    // build system / pnpm changes  → no bump
        'ci',       // CI config                    → no bump
        'chore',    // tooling / housekeeping       → no bump
        'style',    // formatting only              → no bump
      ],
    ],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // Dependabot embeds long dependency tables/URLs in commit bodies and
    // footers. The 100-char defaults from config-conventional reject them.
    // Subject discipline (type-enum, header length) still applies.
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
  },
};
