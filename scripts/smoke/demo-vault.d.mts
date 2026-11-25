// Types for the vault generator, so tests/demo-vault.test.ts can import it.
export function assertInside(root: string, target: string): string;
export function buildVaultFiles(today?: string): Record<string, string>;
export function writeDemoVault(dir: string, opts?: { pluginDir?: string; today?: string }): string[];
