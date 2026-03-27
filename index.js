const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, child } = require('firebase/database');

// ================= CONFIGURACIÓN DE FIREBASE =================
const firebaseConfig = {
    apiKey: "AIzaSyDrNambFw1VNXSkTR1yGq6_B9jWWA1LsxM",
    authDomain: "clientesvip-be9bd.firebaseapp.com",
    projectId: "clientesvip-be9bd",
    storageBucket: "clientesvip-be9bd.firebasestorage.app",
    messagingSenderId: "131036295027",
    appId: "1:13103...", // <--- COMPLETA TU APP ID AQUÍ
    databaseURL: "https://clientesvip-be9bd-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================= CONFIGURACIÓN DEL BOT =================
const token = "7453033146:AAEGX-wStAm62_yguQaMrLSqLG2d9Q6oj9k";
const ADMIN_ID = 7710633235;

const bot = new TelegramBot(token, { polling: true });
const estados = {};

// ================= FUNCIONES DE TECLADO =================
async function mostrarTecladoPaises(chatId, mensaje) {
    try {
        const snapshot = await get(child(ref(db), 'paises'));
        if (snapshot.exists()) {
            const keyboard = [];
            let fila = [];
            
            snapshot.forEach((hijo) => {
                const pais = hijo.key;
                fila.push(`📍 ${pais.toUpperCase()}`);
                if (fila.length === 2) {
                    keyboard.push(fila);
                    fila = [];
                }
            });
            if (fila.length > 0) keyboard.push(fila);

            bot.sendMessage(chatId, mensaje, {
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true
                }
            });
        } else {
            bot.sendMessage(chatId, "Aún no hay países configurados en la base de datos.");
        }
    } catch (error) {
        bot.sendMessage(chatId, "❌ Error al cargar países.");
    }
}

// ================= LÓGICA DE MENSAJES =================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === ADMIN_ID) {
        bot.sendMessage(chatId, "👋 ¡Hola Admin LUCK XIT! ¿Qué deseas hacer?", {
            reply_markup: {
                keyboard: [["➕ Agregar Método Estilizado"], ["👀 Ver Teclado de Clientes"]],
                resize_keyboard: true
            }
        });
    } else {
        mostrarTecladoPaises(chatId, "¡Hola! Selecciona tu país para generar el pago:");
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const texto = msg.text;

    if (!texto || texto === '/start') return;

    // ================= FLUJO DEL ADMIN =================
    if (chatId === ADMIN_ID) {
        if (texto === "➕ Agregar Método Estilizado") {
            estados[chatId] = { paso: "ESPERANDO_DATOS_MULTILINEA" };
            const msjAyuda = `Envíame los datos separados por un salto de línea (Enter). OJO: **Escribe la tasa sin puntos (ej: 3800)**.\n\n*Copia este formato y edítalo:* 👇\n\nColombia\n3800\n🟡 *Bancolombia* (🏦 TRANSFERENCIA)\n📋 N° Cuenta:\n76900007797\n💡 Transferencia Ahorros Bancolombia`;
            
            return bot.sendMessage(chatId, msjAyuda, {
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true }
            });
        }

        if (texto === "👀 Ver Teclado de Clientes") {
            return mostrarTecladoPaises(chatId, "Así ven los clientes los botones:");
        }

        if (estados[chatId] && estados[chatId].paso === "ESPERANDO_DATOS_MULTILINEA") {
            // Filtramos las líneas vacías por si diste un "Enter" de más
            const lineas = texto.split('\n').map(l => l.trim()).filter(l => l !== ''); 
            
            if (lineas.length >= 6) {
                const pais = lineas[0].toLowerCase();
                // Si escribes 3800, lo lee perfecto. (Evita poner 3.800)
                const tasa = parseFloat(lineas[1].replace(/,/g, '')); 
                const tituloBanco = lineas[2];
                const etiquetaCuenta = lineas[3];
                const numeroCuenta = lineas[4];
                const instruccion = lineas[5];
                
                const idMetodo = numeroCuenta.replace(/\s+/g, ''); 

                try {
                    await set(ref(db, `paises/${pais}/tasa`), tasa);
                    await set(ref(db, `paises/${pais}/metodos/${idMetodo}`), {
                        titulo: tituloBanco,
                        etiqueta: etiquetaCuenta,
                        cuenta: numeroCuenta,
                        instruccion: instruccion
                    });
                    
                    bot.sendMessage(chatId, `✅ ¡Éxito! Método agregado a **${pais}**.`, {parse_mode: "Markdown"});
                    delete estados[chatId];
                    
                    bot.sendMessage(chatId, "¿Qué más deseas hacer?", {
                        reply_markup: {
                            keyboard: [["➕ Agregar Método Estilizado"], ["👀 Ver Teclado de Clientes"]],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    bot.sendMessage(chatId, `❌ Error en Firebase: ${error.message}`);
                }
            } else {
                bot.sendMessage(chatId, "❌ Faltan líneas. Recuerda que son 6 datos en total. Intenta de nuevo.");
            }
            return;
        }
    }

    // ================= FLUJO DEL CLIENTE =================
    if (texto.startsWith("📍 ")) {
        const paisSeleccionado = texto.replace("📍 ", "").toLowerCase();
        estados[chatId] = { paso: "ESPERANDO_MONTO", pais: paisSeleccionado };
        
        return bot.sendMessage(chatId, `Elegiste **${paisSeleccionado.toUpperCase()}**.\n\nEscribe la cantidad que deseas pagar en **USD** (Mínimo 3):`, {
            parse_mode: "Markdown",
            reply_markup: { remove_keyboard: true }
        });
    }

    if (estados[chatId] && estados[chatId].paso === "ESPERANDO_MONTO") {
        const montoUSD = parseFloat(texto);
        const pais = estados[chatId].pais;

        if (isNaN(montoUSD) || montoUSD < 3) {
            return bot.sendMessage(chatId, "⚠️ Debes escribir un número válido. El mínimo es **3**.", {parse_mode: "Markdown"});
        }

        try {
            const snapshot = await get(child(ref(db), `paises/${pais}`));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const totalLocal = montoUSD * data.tasa;

                let mensaje = `💰 *TOTAL A PAGAR:* $${montoUSD} USD\n`;
                // Formato de moneda para que se vea como $11,400 en lugar de 11.4
                mensaje += `💱 *EQUIVALENTE:* $${totalLocal.toLocaleString('es-CO')} \n\n`; 
                
                const nombrePaisCapitalizado = pais.charAt(0).toUpperCase() + pais.slice(1);
                mensaje += `🌍 *País:* ${nombrePaisCapitalizado}\n`;
                mensaje += `💸 *Tasa:* ${data.tasa.toLocaleString('es-CO')}\n\n`;
                
                mensaje += `💳 *MÉTODOS DE PAGO DISPONIBLES:*\n\n`;

                // Filtro de seguridad para evitar 'undefined'
                for (const key in data.metodos) {
                    const met = data.metodos[key];
                    if (typeof met === 'object' && met.titulo) {
                        mensaje += `${met.titulo}\n`;
                        mensaje += `${met.etiqueta} \`${met.cuenta}\`\n`; 
                        mensaje += `${met.instruccion}\n\n`;
                    }
                }
                
                bot.sendMessage(chatId, mensaje, {parse_mode: "Markdown"});
                delete estados[chatId]; 
                
                mostrarTecladoPaises(chatId, "¿Necesitas revisar otro país?");
            }
        } catch (error) {
            bot.sendMessage(chatId, "❌ Hubo un error al extraer los datos.");
        }
    }
});


console.log("🚀 Bot iniciado con formato VIP.");
