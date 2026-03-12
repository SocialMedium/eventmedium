var fs = require('fs');
var path = require('path');

async function extractText(filepath, mimetype, originalname) {
  var ext = path.extname(originalname || '').toLowerCase();

  // Plain text / paste
  if (mimetype === 'text/plain' || ext === '.txt') {
    return fs.readFileSync(filepath, 'utf8');
  }

  // PDF
  if (mimetype === 'application/pdf' || ext === '.pdf') {
    var pdfParse = require('pdf-parse');
    var buffer = fs.readFileSync(filepath);
    var data = await pdfParse(buffer);
    return data.text;
  }

  // DOCX
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
    var mammoth = require('mammoth');
    var result = await mammoth.extractRawText({ path: filepath });
    return result.value;
  }

  // PPTX — extract text from slide XML inside the zip
  if (mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === '.pptx') {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip(filepath);
    var entries = zip.getEntries().filter(function(e) {
      return /ppt\/slides\/slide\d+\.xml/.test(e.entryName);
    });
    // Sort by slide number
    entries.sort(function(a, b) {
      var numA = parseInt(a.entryName.match(/slide(\d+)/)[1], 10);
      var numB = parseInt(b.entryName.match(/slide(\d+)/)[1], 10);
      return numA - numB;
    });
    var texts = entries.map(function(e) {
      var xml = e.getData().toString('utf8');
      // Extract text between <a:t> tags
      var matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      return matches.map(function(m) {
        return m.replace(/<\/?a:t>/g, '');
      }).join(' ');
    });
    return texts.join('\n\n');
  }

  throw new Error('Unsupported file type: ' + (mimetype || ext));
}

module.exports = { extractText: extractText };
