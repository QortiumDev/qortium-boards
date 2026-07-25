import { describe, expect, it } from 'vitest';
import { getTransferFiles } from './attachmentInput';

describe('getTransferFiles', () => {
  it('prefers direct clipboard files and falls back to file-kind items', () => {
    const direct = { name: 'direct.png' } as File;
    const fallback = { name: 'clipboard.png' } as File;

    expect(
      getTransferFiles({
        files: { 0: direct, length: 1 },
        items: { 0: { getAsFile: () => fallback, kind: 'file' }, length: 1 },
      }),
    ).toEqual([direct]);
    expect(
      getTransferFiles({
        files: { length: 0 },
        items: { 0: { getAsFile: () => fallback, kind: 'file' }, length: 1 },
      }),
    ).toEqual([fallback]);
  });

  it('does not treat ordinary text paste as an attachment', () => {
    expect(
      getTransferFiles({
        files: { length: 0 },
        items: { 0: { getAsFile: () => null, kind: 'string' }, length: 1 },
      }),
    ).toEqual([]);
  });
});
