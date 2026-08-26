import fs from 'fs';

const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));

const faviconTag = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%230284c7' d='M16 3C16 3 6 15.5 6 21.5a10 10 0 0 0 20 0C26 15.5 16 3 16 3z'/%3E%3Cpath fill='%2338bdf8' d='M16 7.5C16 7.5 9 16.5 9 21.5a7 7 0 0 0 14 0C23 16.5 16 7.5 16 7.5z' opacity='.7'/%3E%3C/svg%3E">
<link rel="icon" href="/favicon.ico" sizes="any">
<script>
  (function(){
    try {
      var t = localStorage.getItem('cww-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (t === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    } catch(e) {}
  })();
</script>`;

for (const file of htmlFiles) {
  let content = fs.readFileSync(file, 'utf8');

  // Remove previous theme scripts in head if any
  content = content.replace(/<script>\s*\(function\(\)\{\s*const t = localStorage\.getItem\('cww-theme'\)[\s\S]*?<\/script>/g, '');
  content = content.replace(/<link rel="icon"[^>]*>/g, '');

  // Inject right after <head>
  content = content.replace(/<head>/i, `<head>\n${faviconTag}`);

  fs.writeFileSync(file, content, 'utf8');
  console.log('Injected favicon & instant theme in:', file);
}
