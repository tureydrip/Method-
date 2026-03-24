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
    appId: "1:13103...", // <--- ¡OJO! COMPLETA TU APP ID AQUÍ
    databaseURL: "https://clientesvip-be9bd-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================= CONFIGURACIÓN DEL BOT =================
const token = "7453033146:AAEGX-wStAm62_yguQaMrLSqLG2d9Q6oj9k";
const ADMIN_ID = 7710633235;

const bot = new TelegramBot(token, { polling: true });

// Objeto para guardar en qué paso está cada usuario
const estados = {};

// ================= FUNCIONES DE TECLADO =================
async function mostrarTecladoPaises(chatId, mensaje) {
    try {
        const snapshot = await get(child(ref(db), 'paises'));
        if (snapshot.exists()) {
            const keyboard = [];
            let fila = [];
            
            // Crear botones con los países de la base de datos
            snapshot.forEach((hijo) => {
                const pais = hijo.key;
                fila.push(`📍 ${pais.toUpperCase()}`);
                
                // Agrupar de 2 en 2 para que el teclado se vea ordenado
                if (fila.length === 2) {
                    keyboard.push(fila);
                    fila = [];
                }
            });
            if (fila.length > 0) keyboard.push(fila); // Agregar si sobra uno impar

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

// ================= LÓGICA DE MENSAJES Y BOTONES =================

// El único comando necesario para arrancar
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId === ADMIN_ID) {
        // Teclado exclusivo para ti (Admin)
        const adminKeyboard = {
            reply_markup: {
                keyboard: [
                    ["➕ Agregar Método"], 
                    ["👀 Ver Teclado de Clientes"]
                ],
                resize_keyboard: true
            }
        };
        bot.sendMessage(chatId, "👋 ¡Hola Admin! ¿Qué deseas hacer?", adminKeyboard);
    } else {
        // Teclado para usuarios normales
        mostrarTecladoPaises(chatId, "¡Hola! Selecciona tu país para generar el pago:");
    }
});

// Escuchar TODO el texto que entra (Botones y respuestas)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const texto = msg.text;

    if (texto === '/start') return; // Evitar que se cruce con la función de arriba

    // ================= FLUJO DEL ADMIN =================
    if (chatId === ADMIN_ID) {
        if (texto === "➕ Agregar Método") {
            estados[chatId] = { paso: "ESPERANDO_DATOS_METODO" };
            const msjAyuda = "Escribe los datos separados por una coma (,)\n\nFormato:\n`Pais, Tasa, Banco, Cuenta`\n\nEjemplo:\n`Colombia, 3900, Nequi, 3214701288`";
            return bot.sendMessage(chatId, msjAyuda, {
                parse_mode: "Markdown",
                reply_markup: { remove_keyboard: true } // Oculta los botones un momento
            });
        }

        if (texto === "👀 Ver Teclado de Clientes") {
            return mostrarTecladoPaises(chatId, "Así ven los clientes los botones:");
        }

        // Si el admin está en el estado de agregar método y envía el texto:
        if (estados[chatId] && estados[chatId].paso === "ESPERANDO_DATOS_METODO") {
            const partes = texto.split(',').map(item => item.trim());
            
            if (partes.length === 4) {
                const [pais, tasa, banco, cuenta] = partes;
                const paisFormato = pais.toLowerCase();

                try {
                    await set(ref(db, `paises/${paisFormato}/tasa`), parseFloat(tasa));
                    await set(ref(db, `paises/${paisFormato}/metodos/${banco}`), cuenta);
                    
                    bot.sendMessage(chatId, `✅ ¡Éxito! Método **${banco}** agregado a **${pais}**.`, {parse_mode: "Markdown"});
                    delete estados[chatId]; // Limpiar el estado
                    
                    // Volver a mostrar tu menú admin
                    bot.sendMessage(chatId, "¿Qué más deseas hacer?", {
                        reply_markup: {
                            keyboard: [["➕ Agregar Método"], ["👀 Ver Teclado de Clientes"]],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    bot.sendMessage(chatId, `❌ Error en Firebase: ${error.message}`);
                }
            } else {
                bot.sendMessage(chatId, "❌ Formato incorrecto. Recuerda separar los 4 datos por coma (,). Intenta de nuevo.");
            }
            return;
        }
    }

    // ================= FLUJO DEL CLIENTE =================
    
    // Si el usuario tocó un botón de país (ej. "📍 COLOMBIA")
    if (texto.startsWith("📍 ")) {
        const paisSeleccionado = texto.replace("📍 ", "").toLowerCase();
        
        // Guardamos el estado del usuario para saber de qué país va a escribir el monto
        estados[chatId] = { paso: "ESPERANDO_MONTO", pais: paisSeleccionado };
        
        return bot.sendMessage(chatId, `Elegiste **${paisSeleccionado.toUpperCase()}**.\n\nEscribe la cantidad que deseas pagar en **USD** (Mínimo 3):`, {
            parse_mode: "Markdown",
            reply_markup: { remove_keyboard: true } // Ocultar teclado de países para que escriba el número
        });
    }

    // Si el usuario está en el paso de escribir cuánto va a pagar
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

                let mensaje = `💰 **Total a pagar:** $${montoUSD} USD\n`;
                mensaje += `💱 **Equivalente:** $${totalLocal.toLocaleString()} (Moneda Local)\n\n`;
                mensaje += `🏦 **Métodos de pago:**\n\n`;

                for (const [banco, cuenta] of Object.entries(data.metodos || {})) {
                    mensaje += `• **${banco}**: \`${cuenta}\`\n`;
                }
                
                mensaje += "\n*(Toca el número de cuenta para copiarlo. Envía la foto del pago por aquí)*";
                
                bot.sendMessage(chatId, mensaje, {parse_mode: "Markdown"});
                delete estados[chatId]; // Finaliza el proceso de este usuario
                
                // Mostrarle los botones de nuevo por si quiere cotizar otra cosa
                mostrarTecladoPaises(chatId, "¿Necesitas revisar otro país?");
            }
        } catch (error) {
            bot.sendMessage(chatId, "❌ Hubo un error al calcular.");
        }
    }
});

console.log("🚀 Bot iniciado con botones. Listo para funcionar.");
