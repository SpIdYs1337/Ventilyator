export function downloadText(name: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name.split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').replace(/[/\\]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
