import React, { useEffect, useState } from 'react';
import './App.css';
import { richiediPermessoNotifiche } from './index';
// Importo le icone da react-icons
import { FaLock, FaLeaf, FaCheck } from 'react-icons/fa';

const FAMIGLIE = ['ermes-ben', 'raya', 'Visualizzatore'];
const PUSH_SERVER_URL = 'https://cani-backend.onrender.com';

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function App() {
  const [famiglia, setFamiglia] = useState('');
  const [famigliaSelezionata, setFamigliaSelezionata] = useState(null);
  const [stato, setStato] = useState(null);
  const [conn, setConn] = useState('connecting');
  const [notificheAttive, setNotificheAttive] = useState(false);
  // Stato per mostrare il pulsante di sblocco dopo 20s
  const [showUnlock, setShowUnlock] = React.useState(false);
  // Stato per attesa backend
  const [backendReady, setBackendReady] = React.useState(false);
  const [isBooking, setIsBooking] = React.useState(false);
  const [bookingConfirmed, setBookingConfirmed] = React.useState(false);
  const bookingTimeout = React.useRef(null);
  const pollingInterval = React.useRef(null);
  // Stati per barra di caricamento
  const [loadingProgress, setLoadingProgress] = React.useState(0);
  const [showLoadingScreen, setShowLoadingScreen] = React.useState(true);
  const loadingInterval = React.useRef(null);

  // Funzione per registrare la subscription push (ora prende la VAPID key dal backend)
  async function registraPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      try {
        // Recupera la VAPID public key dal backend
        const resp = await fetch(PUSH_SERVER_URL + '/api/vapidPublicKey');
        const data = await resp.json();
        const VAPID_PUBLIC_KEY = data.publicKey;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        // Invia la subscription al backend
        await fetch(PUSH_SERVER_URL + '/api/subscribe', {
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
            await fetch(PUSH_SERVER_URL + '/api/unsubscribe', {
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
  function urlBase64ToUint8Array(base64String) {
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

  // Effetto per la barra di caricamento
  React.useEffect(() => {
    // Barra di caricamento che dura 1.5 minuti (90 secondi)
    const totalTime = 90000; // 90 secondi
    const updateInterval = 100; // Aggiorna ogni 100ms
    const increment = (100 / (totalTime / updateInterval));

    loadingInterval.current = setInterval(() => {
      setLoadingProgress(prev => {
        const newProgress = prev + increment;
        if (newProgress >= 100) {
          clearInterval(loadingInterval.current);
          setTimeout(() => setShowLoadingScreen(false), 500); // Aspetta 500ms dopo il 100%
          return 100;
        }
        return newProgress;
      });
    }, updateInterval);

    return () => {
      if (loadingInterval.current) clearInterval(loadingInterval.current);
    };
  }, []);

  // Controllo backend all'avvio
  React.useEffect(() => {
    let stop = false;
    async function checkBackend() {
      try {
        const resp = await fetch(PUSH_SERVER_URL + '/api/health', { method: 'GET' });
        if (resp.ok) {
          setBackendReady(true);
          setConn('connected');
          // Se il backend è pronto prima della fine, completa immediatamente la barra
          setLoadingProgress(100);
          if (loadingInterval.current) clearInterval(loadingInterval.current);
          setTimeout(() => setShowLoadingScreen(false), 500);
          return;
        }
      } catch {}
      if (!stop) setTimeout(checkBackend, 3000);
    }
    checkBackend();
    return () => { stop = true; };
  }, []);

  // Ping periodico per tenere sveglio il backend (ogni 5 minuti)
  React.useEffect(() => {
    const interval = setInterval(() => {
      fetch(PUSH_SERVER_URL + '/api/health').catch(() => {});
    }, 5 * 60 * 1000); // ogni 5 minuti
    return () => clearInterval(interval);
  }, []);

  // Effetto per la polling del backend per aggiornare lo stato del giardino
  useEffect(() => {
    if (!famigliaSelezionata) return;
    
    let stopPolling = false;
    async function pollStato() {
      if (stopPolling) return;
      try {
        const resp = await fetch(`${PUSH_SERVER_URL}/api/stato`);
        if (resp.ok) {
          const data = await resp.json();
          setStato(data);
          setConn('connected');
        } else {
          console.warn('Errore nella polling del stato:', resp.status);
          setConn('error');
        }
      } catch (e) {
        console.warn('Errore nella polling del stato:', e);
        setConn('error');
      }
      if (!stopPolling) {
        pollingInterval.current = setTimeout(pollStato, 2000); // Poll ogni 2 secondi
      }
    }
    pollStato();
    return () => { stopPolling = true; if (pollingInterval.current) clearTimeout(pollingInterval.current); };
  }, [famigliaSelezionata]);

  useEffect(() => {
    if (conn === 'connected' && stato === null) {
      const t = setTimeout(() => setShowUnlock(true), 20000);
      return () => clearTimeout(t);
    } else {
      setShowUnlock(false);
    }
  }, [conn, stato]);

  const pubblicaStato = async (nuovoStato) => {
    if (famigliaSelezionata) {
      try {
        const payload = {
          stato: nuovoStato,
          famiglia: famigliaSelezionata,
          timestamp: Date.now(),
        };
        const resp = await fetch(`${PUSH_SERVER_URL}/api/stato`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          setStato(payload);
        } else {
          console.warn('Errore nella pubblicazione dello stato:', resp.status);
        }
      } catch (e) {
        console.warn('Errore nella pubblicazione dello stato:', e);
      }
    }
  };

  // Quando clicco Occupa Giardino
  const handleOccupa = async () => {
    setIsBooking(true);
    setBookingConfirmed(false);
    await pubblicaStato('occupato');
    // Se dopo 10s non arriva conferma, resetta
    if (bookingTimeout.current) clearTimeout(bookingTimeout.current);
    bookingTimeout.current = setTimeout(() => setIsBooking(false), 10000);
  };

  // Quando arriva il messaggio MQTT di occupazione confermata dalla propria famiglia
  React.useEffect(() => {
    if (isBooking && stato?.stato === 'occupato' && stato.famiglia === famigliaSelezionata) {
      setBookingConfirmed(true);
      setIsBooking(false);
      if (bookingTimeout.current) clearTimeout(bookingTimeout.current);
    }
  }, [isBooking, stato, famigliaSelezionata]);

  // Quando il giardino torna libero, resetta la conferma di booking
  React.useEffect(() => {
    if (bookingConfirmed && stato?.stato === 'libero') {
      setBookingConfirmed(false);
    }
  }, [bookingConfirmed, stato]);

  // Card stato giardino
  let cardGradient = stato && stato.stato === 'occupato'
    ? 'giardino-card-occupato'
    : 'giardino-card-libero';
  let cardIcon = stato && stato.stato === 'occupato'
    ? <span style={{display: 'block', marginBottom: 12}}><FaLock size={48} /></span>
    : <span style={{display: 'block', marginBottom: 12}}><FaLeaf size={48} /></span>;
  let cardTitle = stato && stato.stato === 'occupato' ? 'Giardino occupato' : 'Giardino libero';
  let cardInfo = stato
    ? (stato.stato === 'occupato'
        ? `Occupato da: ${stato.famiglia}\nDal: ${formatDate(stato.timestamp)}`
        : `Ultimo utilizzatore: ${stato.famiglia}\nDal: ${formatDate(stato.timestamp)}`)
    : '';

  // Schermata di caricamento con barra di progresso
  if (showLoadingScreen) {
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: '#222',
            color: '#fff',
            borderRadius: 16,
            width: 450,
            height: 280,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 'bold',
            margin: '0 auto',
            boxShadow: '0 4px 24px #0006',
            position: 'relative',
            padding: '30px',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              Avvio backend...<br />
              <span style={{ fontSize: '18px', color: '#aaa', fontWeight: 'normal' }}>
                Potrebbe volerci qualche momento
              </span>
            </div>
            
            {/* Barra di caricamento */}
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#333',
              borderRadius: '4px',
              overflow: 'hidden',
              marginBottom: '15px'
            }}>
              <div style={{
                width: `${loadingProgress}%`,
                height: '100%',
                backgroundColor: '#4CAF50',
                borderRadius: '4px',
                transition: 'width 0.1s ease-out',
                background: 'linear-gradient(90deg, #4CAF50, #45a049)'
              }} />
            </div>
            
            {/* Percentuale */}
            <div style={{
              fontSize: '16px',
              color: '#4CAF50',
              fontWeight: 'bold'
            }}>
              {Math.round(loadingProgress)}%
            </div>
          </div>
        </header>
      </div>
    );
  }

  if (conn !== 'connected') {
    return (
      <div className="App" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <header className="App-header" style={{ width: '100vw', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
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
            Connessione al backend...
            <div style={{ marginTop: 24, fontSize: 18, color: '#aaa' }}>Attendere...</div>
          </div>
        </header>
      </div>
    );
  }

  // Schermata di caricamento stato giardino
  if (conn === 'connected' && stato === null) {
    // Funzione per pubblicare uno stato iniziale retained
    const pubblicaStatoIniziale = async () => {
      if (famigliaSelezionata) {
        const payload = {
          stato: 'libero',
          famiglia: famigliaSelezionata,
          timestamp: Date.now(),
        };
        try {
          const resp = await fetch(`${PUSH_SERVER_URL}/api/stato`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (resp.ok) {
            setStato(payload);
          } else {
            console.warn('Errore nella pubblicazione dello stato iniziale:', resp.status);
          }
        } catch (e) {
          console.warn('Errore nella pubblicazione dello stato iniziale:', e);
        }
      }
    };
    return (
      <div className="App">
        <header className="App-header">
          <div style={{
            background: '#222',
            color: '#fff',
            borderRadius: 16,
            width: 400,
            height: 260,
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
            Recupero stato giardino...
            <div style={{ marginTop: 24, fontSize: 18, color: '#aaa' }}>Attendere...</div>
            {showUnlock && (
              <button style={{ marginTop: 32, fontSize: 18 }} onClick={pubblicaStatoIniziale}>
                Sblocca (pubblica stato iniziale)
              </button>
            )}
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
        <div className="famiglia-label">
          Famiglia selezionata:<br />
          <span className="famiglia-nome">{famigliaSelezionata}</span>
        </div>
        <div className="notifiche-card">
          <span>Notifiche Push</span>
          <div className="notifiche-switch">
            <label className="switch">
              <input
                type="checkbox"
                checked={notificheAttive}
                onChange={toggleNotifiche}
              />
              <span className="slider round"></span>
            </label>
            <span className="notifiche-stato">{notificheAttive ? 'Attive' : 'Spente'}</span>
          </div>
        </div>
        {/* Card centrale grande come nella foto */}
        <div className={`giardino-card-main ${cardGradient}`}>
          {isBooking ? (
            <>
              <div className="giardino-loader" />
              <div className="giardino-info" style={{marginTop: 18, fontWeight: 500, color: '#fff'}}>
                La tua richiesta sta venendo elaborata...
              </div>
            </>
          ) : bookingConfirmed ? (
            <>
              <div className="giardino-success-icon"><FaCheck /></div>
              <div className="giardino-success-text">Hai prenotato con successo il giardino</div>
              <div className="giardino-info">{cardInfo}</div>
            </>
          ) : (
            <>
              {cardIcon}
              <div className="giardino-title">{cardTitle}</div>
              <div className="giardino-info">{cardInfo}</div>
            </>
          )}
        </div>
        {/* Due pulsanti sempre presenti sotto la card, come nella foto */}
        {!isBooking && !bookingConfirmed && famigliaSelezionata !== 'Visualizzatore' && (
          <div className="bottoni-row-main">
            <button
              className={`btn-main btn-occupa ${stato?.stato === 'libero' ? 'enabled' : 'disabled'}`}
              onClick={stato?.stato === 'libero' ? handleOccupa : undefined}
              disabled={stato?.stato !== 'libero'}
            >
              <span className="btn-icon"><FaLeaf /></span>
              Occupa Giardino
            </button>
            <button
              className={`btn-main btn-libera ${stato?.stato === 'occupato' && stato?.famiglia === famigliaSelezionata ? 'enabled' : 'disabled'}`}
              onClick={stato?.stato === 'occupato' && stato?.famiglia === famigliaSelezionata ? async () => await pubblicaStato('libero') : undefined}
              disabled={!(stato?.stato === 'occupato' && stato?.famiglia === famigliaSelezionata)}
            >
              <span className="btn-icon"><FaCheck /></span>
              Libera Giardino
            </button>
          </div>
        )}

        <div className="mqtt-label">
          <span className="mqtt-dot" /> API: Connesso
        </div>
      </header>
    </div>
  );
}

export default App; 