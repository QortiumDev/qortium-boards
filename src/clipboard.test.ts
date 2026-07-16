import { describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard, type ClipboardDependencies } from './clipboard';

function mockDocument(execCommandResult: boolean) {
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const documentRef = {
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    createElement: vi.fn(() => textarea),
    execCommand: vi.fn(() => execCommandResult),
  };

  return { documentRef, textarea };
}

describe('copyTextToClipboard', () => {
  it('uses navigator.clipboard when the QDN view permits it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const dependencies: ClipboardDependencies = { navigator: { clipboard: { writeText } } };

    await expect(copyTextToClipboard('qdn://APP/Boards/Boards', dependencies)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('qdn://APP/Boards/Boards');
  });

  it('falls back to a selected textarea when navigator.clipboard is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const { documentRef, textarea } = mockDocument(true);
    const dependencies: ClipboardDependencies = {
      document: documentRef as unknown as ClipboardDependencies['document'],
      navigator: { clipboard: { writeText } },
    };

    await expect(copyTextToClipboard('fallback link', dependencies)).resolves.toBe(true);
    expect(textarea.value).toBe('fallback link');
    expect(textarea.select).toHaveBeenCalledTimes(1);
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');
    expect(documentRef.body.removeChild).toHaveBeenCalledTimes(1);
  });

  it('returns false when neither clipboard path is available', async () => {
    await expect(copyTextToClipboard('unavailable', {})).resolves.toBe(false);
  });
});
