const chokidar = require('chokidar');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

console.log('File watcher started'); 
const watchPath =  path.resolve(__dirname, './files');
 
const outputPath = path.resolve(__dirname, './result');
 
if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath);
}
 
function combineXlsxFiles(files) { 
  console.log('Combining files...');
  let finalWorkbook = { SheetNames: [], Sheets: {} };

  files.forEach((file, i) => {
    console.log(`Reading file ${file}`);
    let workbook = XLSX.readFile(file);
    let sheetName = workbook.SheetNames[0];  
    let worksheet = workbook.Sheets[sheetName];

    if (i === 0) { 
      finalWorkbook.SheetNames.push(sheetName);
      finalWorkbook.Sheets[sheetName] = worksheet;
    } else { 
      let newSheetData = XLSX.utils.sheet_to_json(worksheet);
      let finalSheetData = XLSX.utils.sheet_to_json(finalWorkbook.Sheets[sheetName]);

      finalSheetData = finalSheetData.concat(newSheetData);
      finalWorkbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(finalSheetData);
    }
  });

   
  const outputFilePath = path.join(outputPath, 'combined.xlsx');
  XLSX.writeFile(finalWorkbook, outputFilePath);

  console.log(`Combined file written to ${outputFilePath}`);
}

 
const watcher = chokidar.watch(watchPath, {
  ignored: /(^|[\/\\])\../, 
  persistent: true,
});

let xlsxFiles = [];

 
watcher.on('add', (path) => {
  console.log('Combining files...');
  console.log(`File ${path} has been added`);

  if (path.endsWith('.xlsx')) {
    xlsxFiles.push(path);
    combineXlsxFiles(xlsxFiles);
  }
});
