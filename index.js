const fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser')
// Imports the Google Cloud client library
const textToSpeech = require('@google-cloud/text-to-speech');
var app = express();
const PORT = process.env.PORT || 3000

// Creates a client
const client = new textToSpeech.TextToSpeechClient();

// The text to synthesize
const text = "";
const languageCode = "de-DE";

// Construct the request
const request = {
  input: {text: text},
  // Select the language and SSML Voice Gender (optional)
  voice: {languageCode: languageCode, name: "de-DE-Wavenet-B"},
  // Select the type of audio encoding OGG_OPUS, MP3
  audioConfig: {audioEncoding: 'OGG_OPUS', effectsProfileId: [
    "headphone-class-device"
  ]},"pitch": "0.00",
  "speakingRate": "1.00"
};

app.use(bodyParser.json())

app.use('/', express.static(__dirname + '/public'));

app.get('/hello', function (req, res) {
  res.send('Hello World!');
});

app.post('/convert', function (req, res, next) {
  console.log(req.body);
  request.input.text = req.body.text;
  request.voice.languageCode = req.body.languageCode;
  if(req.body.languageCode === languageCode){
    request.voice.name = "de-DE-Wavenet-B";
  } else {
    request.voice.name = "en-US-Wavenet-B";
  }
  /*
  fs.readFile('test.txt', (err, data) => {
    if (err) throw err;
    res.download(test.txt);
  });*/
  
  // Performs the Text-to-Speech request
  client.synthesizeSpeech(request, (err, response) => {
    if (err) {
      console.error('ERROR:', err);
      return;
    }
    res.send(response.audioContent);

    

    /*
    // Write the binary audio content to a local file
    fs.writeFile('output.mp3', response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err);
        return;
      }
      console.log('Audio content written to file: output.mp3');
    });*/
    
  });

});

app.listen(PORT, function () {
  console.log('Example app listening on port 3000!');
});