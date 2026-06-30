const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

let changed = 0;
walkDir('frontend/src/views', (file) => {
  if (!file.endsWith('.jsx')) return;
  
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  if (content.includes('getPriorityBadgeClass') && !content.includes('formatPriority')) {
    content = content.replace(/getPriorityBadgeClass(,?)/g, 'getPriorityBadgeClass, formatPriority$1');
  }

  content = content.replace(/\{ticket\.priority\}/g, '{formatPriority(ticket.priority)}');
  content = content.replace(/\{ticket\.priority\s*\|\|\s*\"[^\"]+\"\}/g, '{formatPriority(ticket.priority)}');
  content = content.replace(/\{item\.priority\}/g, '{formatPriority(item.priority)}');
  content = content.replace(/\{item\.priority\s*\|\|\s*\"[^\"]+\"\}/g, '{formatPriority(item.priority)}');
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Updated', file);
    changed++;
  }
});
console.log('Total files updated:', changed);
