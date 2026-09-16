import {defineConfig} from 'vite';

export default defineConfig({
  build:{rollupOptions:{input:{office:'index.html',documentPreview:'document.html',demo:'demo.html',models:'models.html',narutoPreview:'naruto-preview.html'},output:{manualChunks:{three:['three']}}}}
});
