/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave PIX exibida no widget de apoio. Opcional: sem ela, o widget não aparece. */
  readonly VITE_PIX_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
