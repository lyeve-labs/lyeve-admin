import { describe, expect, it } from 'vitest';
import { externalImports, externalPackage } from './check-server-bundle.mjs';

describe('externalPackage', () => {
  it('names the package behind a bare specifier', () => {
    expect(externalPackage('@lyeve-labs/client')).toBe('@lyeve-labs/client');
    expect(externalPackage('@lyeve-labs/client-rest/types')).toBe('@lyeve-labs/client-rest');
    expect(externalPackage('qrcode/lib/server')).toBe('qrcode');
  });

  it('passes what the image can resolve without node_modules', () => {
    expect(externalPackage('./chunks/a.js')).toBeNull();
    expect(externalPackage('../index.js')).toBeNull();
    expect(externalPackage('node:crypto')).toBeNull();
    expect(externalPackage('http')).toBeNull();
    expect(externalPackage('#internal')).toBeNull();
  });
});

describe('externalImports', () => {
  // The shape adapter-node leaves behind for a package listed in dependencies,
  // which fails the image at the first request that loads it.
  it('finds a bare import the bundle left for node_modules', () => {
    const source = [
      "import { ApiError, createClient } from '@lyeve-labs/client';",
      "import 'qrcode';",
      "export { x } from \"@lyeve-labs/client-rest\";",
    ].join('\n');
    expect(externalImports(source)).toEqual([
      '@lyeve-labs/client',
      '@lyeve-labs/client-rest',
      'qrcode',
    ]);
  });

  it('stays silent on a bundle that carries everything', () => {
    const source = [
      "import { createHash } from 'node:crypto';",
      "import http from 'http';",
      "import { a } from './chunks/a.js';",
      "const otel = await import('@opentelemetry/api').catch(() => null);",
      "const text = 'import x from \"y\"';",
    ].join('\n');
    expect(externalImports(source)).toEqual([]);
  });
});
