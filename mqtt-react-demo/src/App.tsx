import React, { useEffect, useRef, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import './App.css';
import { richiediPermessoNotifiche } from './index';

const MQTT_BROKER = 'wss://test.mosquitto.org:8081';
const TOPIC = 'giardino/stato';
const FAMIGLIE = ['ermes-ben', 'raya', 'Visualizzatore'];
const PUSH_SERVER_URL = 'https://cani-backend.onrender.com';

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
  const [notificheAttive, setNotificheAttive] = useState<boolean>(false);
  const clientRef = useRef<MqttClient | null>(null);

  // Funzione per registrare la subscription push (ora prende la VAPID key dal backend)
  async function registraPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      try {
        // Recupera la VAPID public key dal backend
        const resp = await fetch(PUSH_SERVER_URL + '/vapidPublicKey');
        const data = await resp.json();
        const VAPID_PUBLIC_KEY = data.publicKey;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        // Invia la subscription al backend
        await fetch(PUSH_SERVER_URL + '/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub)
        });
        console.log('Push subscription inviata al backend:', JSON.stringify(sub));
        return true;
      } catch (e) {
        console.warn('Push subscription error', e);
        return false;
      }
    }
    return false;
  }

  // Funzione per cancellare la subscription push
  async function cancellaPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      try {
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          // Notifica il backend della cancellazione
          try {
            await fetch(PUSH_SERVER_URL + '/unsubscribe', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: subscription.endpoint })
            });
          } catch (e) {
            console.warn('Errore notifica cancellazione al backend:', e);
          }
          
          await subscription.unsubscribe();
          console.log('Push subscription cancellata');
          return true;
        }
      } catch (e) {
        console.warn('Push unsubscription error', e);
      }
    }
    return false;
  }

  // Funzione per gestire l'attivazione/disattivazione delle notifiche
  async function toggleNotifiche() {
    if (!notificheAttive) {
      // Attiva notifiche
      const perm = await richiediPermessoNotifiche();
      if (perm === 'granted') {
        const success = await registraPush();
        if (success) {
          setNotificheAttive(true);
          localStorage.setItem('notificheAttive', 'true');
        }
      }
    } else {
      // Disattiva notifiche
      const success = await cancellaPush();
      if (success) {
        setNotificheAttive(false);
        localStorage.setItem('notificheAttive', 'false');
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

  // Recupera la famiglia selezionata e lo stato notifiche da localStorage all'avvio
  useEffect(() => {
    const salvata = localStorage.getItem('famiglia');
    const notificheSalvate = localStorage.getItem('notificheAttive');
    if (salvata) {
      setFamigliaSelezionata(salvata);
      setFamiglia(salvata);
    }
    if (notificheSalvate) {
      setNotificheAttive(notificheSalvate === 'true');
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
              {FAMIGLIE.map(f => (
                <option key={f} value={f}>
                  {f === 'Visualizzatore' ? 'Visualizzatore (solo lettura)' : f}
                </option>
              ))}
            </select>
            <button
              style={{ fontSize: 20, padding: '10px 24px' }}
              disabled={!famiglia}
              onClick={async () => {
                setFamigliaSelezionata(famiglia);
                localStorage.setItem('famiglia', famiglia);
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
          {famigliaSelezionata === 'Visualizzatore' && (
            <div style={{ fontSize: 14, color: '#aaa', marginTop: 8 }}>
              Modalità solo visualizzazione
            </div>
          )}
        </div>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 12, 
          marginBottom: 24, 
          fontSize: 16, 
          color: '#fff',
          background: '#333',
          padding: '12px 16px',
          borderRadius: 8
        }}>
          <span>Notifiche push:</span>
          <label style={{ 
            position: 'relative', 
            display: 'inline-block', 
            width: 50, 
            height: 24 
          }}>
            <input
              type="checkbox"
              checked={notificheAttive}
              onChange={toggleNotifiche}
              style={{ 
                opacity: 0, 
                width: 0, 
                height: 0 
              }}
            />
            <span style={{
              position: 'absolute',
              cursor: 'pointer',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: notificheAttive ? '#4CAF50' : '#ccc',
              transition: '.4s',
              borderRadius: 24,
            }}>
              <span style={{
                position: 'absolute',
                content: '""',
                height: 18,
                width: 18,
                left: 3,
                bottom: 3,
                backgroundColor: 'white',
                transition: '.4s',
                borderRadius: '50%',
                transform: notificheAttive ? 'translateX(26px)' : 'translateX(0)'
              }} />
            </span>
          </label>
          <span style={{ fontSize: 14, color: '#aaa' }}>
            {notificheAttive ? 'Attive' : 'Disattive'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
          <button
            style={{ fontSize: 18, padding: '10px 24px' }}
            onClick={() => pubblicaStato('occupato')}
            disabled={
              famigliaSelezionata === 'Visualizzatore' ||
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
              famigliaSelezionata === 'Visualizzatore' ||
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
