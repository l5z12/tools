// SPDX-License-Identifier: AGPL-3.0-only
import { modernSpecs, codecIds } from "./lib/codec-tools";
import { randomHex } from "./crypto-runtime";
import { suiteCore } from "./workbench-core";
import type { SuiteResult } from "./workbench-types";
const input = (key: string) =>
  document.getElementById("suite-" + key) as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function button(label: string, action: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.onclick = action;
  return b;
}
export function configureCrypto(
  id: string,
  container: HTMLElement,
  onChange: () => void,
) {
  const spec = modernSpecs.find((s) => "crypto-" + s[0] === id);
  if (spec) {
    container.append(
      button("Generate random key", () => {
        input("key").value = randomHex(spec[2]);
        onChange();
      }),
    );
    if (
      !["aes-gcm", "chacha20-poly1305", "xchacha20-poly1305"].includes(spec[0])
    ) {
      input("aad").hidden = true;
      container.querySelector<HTMLLabelElement>(
        "label[for=suite-aad]",
      )!.hidden = true;
    }
  }
  if (id === "crypto-pbkdf2" || id === "crypto-hkdf")
    container.append(
      button("Generate random salt", () => {
        input("salt").value = randomHex(16);
        onChange();
      }),
    );
  if (id === "crypto-rsa-oaep") {
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const keys = document.createElement("div");
    const generate = button("Generate RSA key pair", async () => {
      generate.disabled = true;
      status.textContent = "Generating keys…";
      keys.replaceChildren();
      try {
        const result = await suiteCore(
          "crypto-keypair",
          "",
          new Uint8Array(),
          {},
        );
        if (!container.contains(generate)) return;
        const pair = result.data as { publicKey: string; privateKey: string };
        for (const [label, key] of [
          ["Public key", pair.publicKey],
          ["Private key", pair.privateKey],
        ]) {
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = label;
          const pre = document.createElement("pre");
          pre.textContent = key;
          const use = button("Use " + label.toLowerCase(), () => {
            input("key").value = key;
            input("mode").value =
              label === "Public key" ? "Encrypt" : "Decrypt";
            onChange();
          });
          const download = document.createElement("a");
          download.textContent = "Save " + label.toLowerCase();
          download.download =
            label === "Public key" ? "public.pem" : "private.pem";
          download.href = "data:application/x-pem-file;base64," + btoa(key);
          details.append(
            summary,
            pre,
            use,
            document.createTextNode(" · "),
            download,
          );
          keys.append(details);
        }
        input("key").value = pair.publicKey;
        input("mode").value = "Encrypt";
        onChange();
        status.textContent =
          "Key pair ready. Public key selected for encryption. Keep the private key to decrypt.";
      } catch (e) {
        status.textContent = String(e);
      } finally {
        generate.disabled = false;
      }
    });
    container.append(generate, status, keys);
  }
}
export function renderCodecActions(
  container: HTMLElement,
  id: string,
  result: SuiteResult,
  onChange: () => void,
) {
  if (!codecIds.has(id) || result.kind !== "code" || !result.text) return;
  if (new TextEncoder().encode(result.text).length > 2_000_000) {
    const note = document.createElement("p");
    note.textContent =
      "This result exceeds the text input limit. Save the result and choose it as a file to decode or decrypt.";
    container.append(note);
    return;
  }
  const mode = input("mode");
  if (!mode) return;
  const encrypt = mode.value === "Encrypt";
  const encode = mode.value === "Encode";
  // Only offer textual round trips; decrypted binary must remain byte-exact.
  if (!encrypt && !encode && result.files?.some((f) => f.name === "result.bin"))
    return;
  const transfer = button(
    encrypt
      ? "Use ciphertext for decryption"
      : encode
        ? "Use encoded result for decoding"
        : "Use result as input",
    () => {
      (document.getElementById("input") as HTMLTextAreaElement).value =
        result.text!;
      const picker = document.getElementById(
        "suite-file",
      ) as HTMLInputElement | null;
      if (picker) picker.value = "";
      mode.value = encrypt
        ? "Decrypt"
        : encode
          ? "Decode"
          : mode.value === "Decrypt"
            ? "Encrypt"
            : "Encode";
      const format = input("inputFormat");
      if (format && id.startsWith("crypto-")) format.value = "Envelope";
      if (format && id === "cipher-rc4") format.value = "Hex";
      onChange();
    },
  );
  if (id === "cipher-xor") return;
  container.append(transfer);
}
