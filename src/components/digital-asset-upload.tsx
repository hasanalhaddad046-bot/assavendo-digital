"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { createDigitalAssetUpload, registerDigitalAsset } from "@/app/admin/actions";

const MAX_BYTES = 50 * 1024 * 1024;
const MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
]);

let browserStorage: ReturnType<typeof createClient> | null = null;
function storageClient() {
  if (!browserStorage) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Le service de stockage public n'est pas configuré.");
    browserStorage = createClient(url, key, { auth: { persistSession: false } });
  }
  return browserStorage;
}

async function checksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function DigitalAssetUpload({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setMessage("Choisissez un fichier valide.");
      return;
    }
    if (file.size > MAX_BYTES || !MIME.has(file.type)) {
      setMessage("Format non autorisé ou fichier supérieur à 50 Mo.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const uploadForm = new FormData();
      uploadForm.set("product_id", productId);
      uploadForm.set("file_name", file.name);
      uploadForm.set("mime_type", file.type);
      uploadForm.set("size_bytes", String(file.size));
      const target = await createDigitalAssetUpload(uploadForm);
      if (!target || target.ok !== true) throw new Error(target?.error || "Préparation du dépôt impossible.");

      const digest = await checksum(file);
      const { error: uploadError } = await storageClient().storage
        .from("digital-assets")
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw new Error("Téléversement impossible : " + uploadError.message);

      const registerForm = new FormData();
      registerForm.set("product_id", productId);
      registerForm.set("storage_path", target.path);
      registerForm.set("file_name", file.name);
      registerForm.set("mime_type", file.type);
      registerForm.set("size_bytes", String(file.size));
      registerForm.set("checksum_sha256", digest);
      const saved = await registerDigitalAsset(registerForm);
      if (!saved?.ok) throw new Error(saved?.error || "Fichier reçu mais non enregistré dans le catalogue numérique.");

      setMessage("Fichier téléversé dans le bucket privé. Il reste non publiable tant que le contrôle qualité et les droits ne sont pas validés.");
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec du téléversement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="buy" onSubmit={submit}>
      <h3>Ajouter un fichier numérique (bucket privé)</h3>
      <label>Fichier
        <input name="file" type="file" accept=".pdf,.zip,.epub,.docx,.xlsx,.png,.jpg,.jpeg" required />
      </label>
      <p className="muted">Formats autorisés : PDF, ZIP, EPUB, DOCX, XLSX, PNG et JPEG. Taille maximale : 50 Mo.</p>
      {message && <p role="status">{message}</p>}
      <button disabled={busy}>{busy ? "Téléversement en cours…" : "Téléverser en privé"}</button>
    </form>
  );
}

