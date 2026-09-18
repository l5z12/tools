// SPDX-License-Identifier: AGPL-3.0-only
interface TextDraft {
  input: string;
  option: string;
}

/** Keep bounded, temporary text drafts in memory; never write inputs to storage. */
export class TextDrafts {
  private entries = new Map<string, TextDraft>();
  private readonly maximumCharacters = 2_000_000;

  save(id: string, draft: TextDraft): void {
    this.entries.delete(id);
    if (draft.input.length + draft.option.length > this.maximumCharacters)
      return;
    this.entries.set(id, { ...draft });
    while (this.entries.size > 8 || this.size() > this.maximumCharacters) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  read(id: string): TextDraft | undefined {
    return this.entries.get(id);
  }

  private size(): number {
    return [...this.entries.values()].reduce(
      (size, draft) => size + draft.input.length + draft.option.length,
      0,
    );
  }
}
