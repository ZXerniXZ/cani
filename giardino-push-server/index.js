import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import webpush from 'web-push';
import mqtt from 'mqtt';
import fs from 'fs';

const VAPID_PUBLIC_KEY = 'BB8l__PCTsH5Xb1gaDl5pAO-XyrUJOCtD8JdJYyJhCxVacLalgk4dnWyHYkp3_q6yT8KVT4N2C3ziwGOA6tUcRQ';
const VAPID_PRIVATE_KEY = 'VnYONU0T2FAKAl3zHXeo2yZpjffzggoABinzANlt9lQ';

webpush.setVapidDetails(
  'mailto:tuamail@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SUBSCRIPTIONS_FILE = './subscriptions.json';

let subscriptions = [];
if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
  subscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE));
}

function saveSubscriptions() {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    saveSubscriptions();
    console.log('Nuova subscription registrata');
  }
  res.status(201).json({});
});

const MQTT_BROKER = 'mqtt://test.mosquitto.org';
const MQTT_TOPIC = 'giardino/stato';

const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('Connesso a MQTT');
  mqttClient.subscribe(MQTT_TOPIC);
});

mqttClient.on('message', (topic, message) => {
  if (topic === MQTT_TOPIC) {
    const data = JSON.parse(message.toString());
    let title, body;
    if (data.stato === 'occupato') {
      title = 'Giardino occupato';
      body = `Occupato da ${data.famiglia} dal ${new Date(data.timestamp).toLocaleString()}`;
    } else {
      title = 'Giardino libero';
      body = `Liberato da ${data.famiglia} il ${new Date(data.timestamp).toLocaleString()}`;
    }
    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, JSON.stringify({ title, body }))
        .catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
            saveSubscriptions();
          }
        });
    });
    console.log('Notifica inviata:', title, body);
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Push server in ascolto su http://localhost:${PORT}`);
});