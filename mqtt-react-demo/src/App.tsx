import React, { useEffect, useRef, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import './App.css';
import { richiediPermessoNotifiche } from './index';

const MQTT_BROKER = 'wss://test.mosquitto.org:8081';
const TOPIC = 'giardino/stato';
const FAMIGLIE = ['Rossi', 'Bianchi'];
const VAPID_PUBLIC_KEY = 'BB8l__PCTsH5Xb1gaDl5pAO-XyrUJOCtD8JdJYyJhCxVacLalgk4dnWyHYkp3_q6yT8KVT4N2C3ziwGOA6tUcRQ';

type StatoGiardino = {
  stato: 'libero' | 'occupato';
  famiglia: string;
  timestamp: number;
};

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function App() {
  const [famiglia, setFamiglia] = useState<string>('');
  const [famigliaSelezionata, setFamigliaSelezionata] = useState<string | null>(null);
  const [stato, setStato] = useState<StatoGiardino | null>(null);
  const [conn, setConn] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const clientRef = useRef<MqttClient | null>(null);

  // Funzione per registrare la subscription push (placeholder, backend dopo)
  async function registraPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      try {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        // Invia la subscription al backend
        await fetch('http://localhost:4000/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub)
        });
        console.log('Push subscription inviata al backend:', JSON.stringify(sub));
      } catch (e) {
        console.warn('Push subscription error', e);
      }
    }
  }

  // Funzione di utilità per VAPID key
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Recupera la famiglia selezionata da localStorage all'avvio
  useEffect(() => {
    const salvata = localStorage.getItem('famiglia');
    if (salvata) {
      setFamigliaSelezionata(salvata);
      setFamiglia(salvata);
    }
  }, []);

  useEffect(() => {
    const client = mqtt.connect(MQTT_BROKER);
    clientRef.current = client;

    client.on('connect', () => {
      setConn('connected');
      client.subscribe(TOPIC);
    });
    client.on('error', () => {
      setConn('connecting'); // Riprova sempre
    });
    client.on('message', (topic, msg) => {
      if (topic === TOPIC) {
        try {
          const data = JSON.parse(msg.toString());
          if (data.stato && data.famiglia && data.timestamp) {
            setStato(data);
          }
        } catch {}
      }
    });
    return () => { client.end(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pubblicaStato = (nuovoStato: 'libero' | 'occupato') => {
    if (clientRef.current && clientRef.current.connected && famigliaSelezionata) {
      const payload: StatoGiardino = {
        stato: nuovoStato,
        famiglia: famigliaSelezionata,
        timestamp: Date.now(),
      };
      clientRef.current.publish(TOPIC, JSON.stringify(payload));
      // Aggiornamento ottimistico locale
      setStato(payload);
    }
  };

  let boxClass = 'giardino-card';
  let boxText = 'Giardino libero';
  let infoText = '';
  if (stato) {
    if (stato.stato === 'occupato') {
      boxClass += ' occupato';
      boxText = 'Giardino occupato';
      infoText = `Occupato da: ${stato.famiglia} dal ${formatDate(stato.timestamp)}`;
    } else {
      boxText = 'Giardino libero';
      infoText = `Ultimo utilizzatore: ${stato.famiglia} (liberato il ${formatDate(stato.timestamp)})`;
    }
  }

  if (conn !== 'connected') {
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: '#222',
            color: '#fff',
            borderRadius: 16,
            width: 400,
            height: 220,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            fontWeight: 'bold',
            margin: '0 auto',
            boxShadow: '0 4px 24px #0006',
            position: 'relative',
          }}>
            Connessione al broker MQTT...
            <div style={{ marginTop: 24, fontSize: 18, color: '#aaa' }}>Attendere...</div>
          </div>
        </header>
      </div>
    );
  }

  // Schermata di selezione famiglia
  if (!famigliaSelezionata) {
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: '#222',
            color: '#fff',
            borderRadius: 16,
            width: 400,
            height: 220,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 'bold',
            margin: '0 auto',
            boxShadow: '0 4px 24px #0006',
            position: 'relative',
          }}>
            <div style={{ marginBottom: 32 }}>Seleziona la tua famiglia:</div>
            <select
              value={famiglia}
              onChange={e => setFamiglia(e.target.value)}
              style={{ fontSize: 22, marginBottom: 24 }}
            >
              <option value="" disabled>-- Scegli --</option>
              {FAMIGLIE.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <button
              style={{ fontSize: 20, padding: '10px 24px' }}
              disabled={!famiglia}
              onClick={async () => {
                setFamigliaSelezionata(famiglia);
                localStorage.setItem('famiglia', famiglia);
                const perm = await richiediPermessoNotifiche();
                if (perm === 'granted') {
                  await registraPush();
                }
              }}
            >
              Conferma
            </button>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <h2>Gestione Giardino</h2>
        <div style={{ marginBottom: 24, fontSize: 18, color: '#fff' }}>
          Famiglia selezionata: <b>{famigliaSelezionata}</b>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
          <button
            style={{ fontSize: 18, padding: '10px 24px' }}
            onClick={() => pubblicaStato('occupato')}
            disabled={
              (stato?.stato === 'occupato' && stato?.famiglia === famigliaSelezionata) ||
              (stato?.stato === 'occupato' && stato?.famiglia !== famigliaSelezionata)
            }
          >
            Occupa giardino
          </button>
          <button
            style={{ fontSize: 18, padding: '10px 24px' }}
            onClick={() => pubblicaStato('libero')}
            disabled={
              !(stato?.stato === 'occupato' && stato?.famiglia === famigliaSelezionata)
            }
          >
            Libera giardino
          </button>
        </div>
        <div className={boxClass}>
          {boxText}
          <div className="giardino-info">{infoText}</div>
        </div>
        <div style={{ marginTop: 32, fontSize: 16, color: '#aaa' }}>
          Stato MQTT: {conn === 'connected' ? 'Connesso' : conn === 'connecting' ? 'Connessione...' : 'Errore'}
        </div>
      </header>
    </div>
  );
}

export default App;
