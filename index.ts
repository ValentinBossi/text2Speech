import { unlink, writeFile } from 'fs';
import * as express from 'express';
import { json } from 'body-parser';
// Imports the Google Cloud client library
import { TextToSpeechClient } from '@google-cloud/text-to-speech'
import { google } from "@google-cloud/text-to-speech/build/protos/protos";
import ISynthesizeSpeechRequest = google.cloud.texttospeech.v1.ISynthesizeSpeechRequest;
import * as ffmpeg from 'fluent-ffmpeg'
import * as uuid from 'uuid'
import axios from 'axios'
import * as Readability from './public/Readability'
import * as jsdom from 'jsdom';
const { JSDOM } = jsdom;
const app = express();
const PORT = process.env.PORT || 3000;
process.env['GOOGLE_APPLICATION_CREDENTIALS'] = 'text2speech-214408-bd390a3b6140.json';

// Creates a client
const client = new TextToSpeechClient();

app.use(json())

app.use('/', express.static(__dirname + '/public', {maxAge: 60 * 60 * 24 * 365 * 1000}));

app.post('/converturl', function (req, res, next) {

  if (req.body.url.includes('www.tagesanzeiger.ch')) {
    console.log('Using playwright to get payed content')
    axios.get('https://secret-forest-80542.herokuapp.com/pagecontent', {data: {url: req.body.url}})
    .then(function (response) {
      const { document } = (new JSDOM(response.data.content)).window;
      const article = new Readability(document, null).parse();
      console.log(article.textContent)
      // handle success
      res.json({ textContent: article.textContent });
    })
    .catch(function (error) {
      // handle error
      next(error);
    })
  } else {
    axios.get(req.body.url)
    .then(function (response) {
      const { document } = (new JSDOM(response.data)).window;
      const article = new Readability(document, null).parse();
      console.log(article.textContent)
      // handle success
      res.json({ textContent: article.textContent });
    })
    .catch(function (error) {
      // handle error
      next(error);
    })
  }
  
})

app.post('/convert', function (req, res, next) {
  console.log(req.body);

  
  let voiceNameDeM = "de-DE-Wavenet-B";
  let voiceNameDeF = "de-DE-Wavenet-C";
  let voiceNameFrM = "fr-FR-Wavenet-B";
  let voiceNameFrF = "fr-FR-Wavenet-A";
  let voiceNameEnM = "en-GB-Wavenet-D";
  let voiceNameEnF = "en-GB-Wavenet-A";
  let gender = "male";
  let voiceName = voiceNameDeM;
  let languageCode = 'de-DE'

  if (req.body.gender !== gender) {
    voiceName = voiceNameDeF;
  }
  if (req.body.languageCode === 'fr-FR') {
    voiceName = req.body.languageCode === 'fr-FR' && req.body.gender === gender ? voiceNameFrM : voiceNameFrF;
  } else if (req.body.languageCode === 'en-US') {
    voiceName = req.body.languageCode === 'en-US' && req.body.gender === gender ? voiceNameEnM : voiceNameEnF;
  }

  let sentencesArray;
  let sentencesChunks;
  let chunksAndFilename = [];
  let audioRespones = [];
  let text = resizeText(req.body.text);
  sentencesArray = createSentencesArray(text);
  sentencesChunks = buildSentencesChunks(sentencesArray);
  chunksAndFilename = sentencesChunks.map((textChunk) => {
    return { textChunk: textChunk, filename: uuid() };
  });

  if(chunksAndFilename.length === 0) {
    return res.status(400).end();
  }

  // rekursiver aufruf machen damit alle anfragen sequentiell erfolgen und dann am schluss die mp3's konkateniert und nach wave konvertiert
  //werden und an den client geschickt werden kann
  for (let index = 0; index < chunksAndFilename.length; index++) {
    audioRespones.push(new Promise((resolve) => {
      // Construct the request
      let request: ISynthesizeSpeechRequest = {
        input: { text: chunksAndFilename[index].textChunk },
        // Select the language and SSML Voice Gender (optional)
        voice: { languageCode: languageCode, name: voiceName },
        // Select the type of audio encoding OGG_OPUS, MP3, LINEAR16
        audioConfig: {
          audioEncoding: 'LINEAR16', effectsProfileId: [
            "headphone-class-device"
          ],
          "pitch": 0,
          "speakingRate": 1
        }
      };
      // Performs the Text-to-Speech request
      client.synthesizeSpeech(request, (err, response) => {
        if (err) {
          console.error('ERROR:', err);
          return;
        }
        console.log(response.audioContent);
        saveAndConvert(response, chunksAndFilename[index].filename, resolve);
      });

    }));
  }

  Promise.all(audioRespones).then(filenames => {
    let mergedFilename = uuid();
    let command = ffmpeg();
    for (let index = 0; index < filenames.length; index++) {
      command.input(__dirname + "/public/" + filenames[index] + ".wav");
    }
    if (filenames.length === 1) {
      command.audioBitrate('48k').save(__dirname + "/public/" + mergedFilename + ".mp3").on('error', function (err) {
        console.log('An error occurred when saving mp3: ' + err.message);
      }).on('end', function () {
        res.sendFile(__dirname + "/public/" + mergedFilename + ".mp3", function (err) {
          if (err) {
            next(err);
          } else {
            console.log('Sent: merged mp3: ' + mergedFilename + ".mp3");
            filenames.map((filename) => {
              unlink(__dirname + "/public/" + filename + ".wav", (err) => {
                if (err) throw err;
                console.log('path/file.txt was deleted');
              });
            });
            unlink(__dirname + "/public/" + mergedFilename + ".mp3", (err) => {
              if (err) throw err;
              console.log('path/file.txt was deleted');
            });
          }
        });
      });
    } if (filenames.length > 1) {
      command.mergeToFile(__dirname + "/public/" + mergedFilename + ".wav").on("end", () => {
        command = ffmpeg();
        command.input(__dirname + "/public/" + mergedFilename + ".wav").audioBitrate('48k').save(__dirname + "/public/" + mergedFilename + ".mp3").on('error', function (err) {
          console.log('An error occurred when joining mp3s: ' + err.message);
        }).on('end', function () {
          console.log('Merging finished !');
          res.sendFile(__dirname + "/public/" + mergedFilename + ".mp3", function (err) {
            if (err) {
              next(err);
            } else {
              console.log('Sent: merged mp3: ' + mergedFilename + ".mp3");
              filenames.map((filename) => {
                unlink(__dirname + "/public/" + filename + ".wav", (err) => {
                  if (err) throw err;
                  console.log('path/file.txt was deleted');
                });
              });
              unlink(__dirname + "/public/" + mergedFilename + ".wav", (err) => {
                if (err) throw err;
                console.log('path/file.txt was deleted');
              });
              unlink(__dirname + "/public/" + mergedFilename + ".mp3", (err) => {
                if (err) throw err;
                console.log('path/file.txt was deleted');
              });
            }
          });
        });
      });
    }
  }).catch((err) => { console.log("error promise.all: ", err) });
});

app.listen(PORT, function () {
  console.log('Example app listening on port ' + PORT +'!');
});

const saveAndConvert = (response, filename, resolve) => {

  writeFile(__dirname + '/public/' + filename + '.wav', response.audioContent, 'binary', err => {
    if (err) {
      console.error('ERROR:', err);
      return;
    }
    console.log('Audio content written to file: ' + filename + '.wav');
    resolve(filename);
  });
}
// resizeText to maximum 10000 characters. 1392 chars per request
const resizeText = (text) => {
  if (text) {
    return text.substring(0, 100000);
  } else {
    return "";
  }
}

const createSentencesArray = (text) => {
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g);
  if (sentences) {
    return sentences;
  } else {
    return [];
  }
}

const buildSentencesChunks = (sentencesArray) => {

  let sentencesChunks = [];

  while (sentencesArray.length !== 0) {
    let chunkAndIndex = buildOneChunk(sentencesArray);
    sentencesChunks.push(chunkAndIndex.chunk);
    sentencesArray = sentencesArray.slice(chunkAndIndex.index);
  }
  return sentencesChunks;
}

const buildOneChunk = (sentencesArray) => {
  let textChunk = "";
  let length = 0;
  for (let index = 0; index < sentencesArray.length; index++) {
    length = textChunk.length + sentencesArray[index].length;
    if (length <= 1200) {
      textChunk = textChunk + sentencesArray[index];
    } else {
      return { chunk: textChunk, index: index };
    }
  }
  return { chunk: textChunk, index: sentencesArray.length }
}