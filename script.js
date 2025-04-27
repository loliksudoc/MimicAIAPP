const chat = document.getElementById('chat');
const userInput = document.getElementById('user_input');
const modelSelect = document.getElementById('model_select');
const styleSelect = document.getElementById('style_select');
const sendButton = document.getElementById('send_button');
const generateImageButton = document.getElementById('generate_image_button');
const translateCheckbox = document.getElementById('translate_checkbox');

// Таймауты (в миллисекундах)
const API_TIMEOUT = 30000; // 30 секунд для API запросов
const TYPING_ANIMATION_INTERVAL = 500; // Анимация "печатает"

function loadUserAvatar() {
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe?.user?.photo_url) {
        document.getElementById('user_avatar').src = Telegram.WebApp.initDataUnsafe.user.photo_url;
    }
}

function appendMessage(content, sender = "bot") {
    const msg = document.createElement('div');
    msg.classList.add('message', sender);
    msg.innerHTML = sender === "user" ?
        `<img src="${Telegram.WebApp.initDataUnsafe?.user?.photo_url || 'assets/user_default.png'}" alt="User Avatar"> ${content}` :
        content;
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
    return msg; // Возвращаем элемент сообщения для последующего управления
}

function loadChatHistory() {
    const history = JSON.parse(localStorage.getItem('chatHistory')) || [];
    history.forEach(msg => appendMessage(msg.content, msg.sender));
}

function saveChatHistory(content, sender) {
    const history = JSON.parse(localStorage.getItem('chatHistory')) || [];
    history.push({ content, sender });
    localStorage.setItem('chatHistory', JSON.stringify(history));
}

async function translateText(text, targetLang = 'ru') {
    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        return data[0][0][0];
    } catch (error) {
        console.error("Translation error:", error);
        return text;
    }
}

function createTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.classList.add('message', 'bot', 'typing-indicator');
    indicator.innerHTML = `
        <div class="typing-content">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
        </div>
    `;
    chat.appendChild(indicator);
    chat.scrollTop = chat.scrollHeight;
    return indicator;
}

function removeTypingIndicator(indicator) {
    if (indicator && indicator.parentNode) {
        indicator.remove();
    }
}

async function withTimeout(promise, timeout, errorMessage) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeout);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function sendMessage() {
    let text = userInput.value.trim();
    if (!text) return;

    // Сохраняем оригинальное сообщение пользователя
    appendMessage(text, "user");
    userInput.value = '';
    userInput.disabled = true;
    sendButton.disabled = true;

    // Показываем индикатор печати
    const typingIndicator = createTypingIndicator();

    try {
        // Переводим текст если нужно
        let apiText = text;
        if (translateCheckbox.checked) {
            apiText = await withTimeout(
                translateText(text, 'en'),
                API_TIMEOUT,
                'Превышено время ожидания перевода'
            );
        }

        const payload = {
            model: modelSelect.value,
            messages: [{"role": "user", "content": apiText}],
            max_tokens: 512,
            temperature: 0.7
        };

        const headers = {
            "Authorization": `Bearer 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`,
            "Content-Type": "application/json"
        };

        // Отправляем запрос с таймаутом
        const response = await withTimeout(
            fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload)
            }),
            API_TIMEOUT,
            'Превышено время ожидания ответа от API'
        );

        if (!response.ok) {
            throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data?.choices?.[0]?.message?.content) {
            let reply = data.choices[0].message.content;
            
            // Переводим ответ обратно если нужно
            if (translateCheckbox.checked) {
                reply = await withTimeout(
                    translateText(reply, 'ru'),
                    API_TIMEOUT,
                    'Превышено время ожидания обратного перевода'
                );
            }
            
            removeTypingIndicator(typingIndicator);
            appendMessage(reply, "bot");
            saveChatHistory(reply, "bot");
        } else {
            throw new Error("Ответ от API не содержит данных.");
        }
    } catch (error) {
        console.error("Ошибка при отправке сообщения:", error);
        removeTypingIndicator(typingIndicator);
        appendMessage(`Ошибка: ${error.message}`, "bot");
    } finally {
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }
}

async function generateImage() {
    let text = userInput.value.trim();
    if (!text) return;

    appendMessage(text, "user");
    userInput.value = '';
    userInput.disabled = true;
    generateImageButton.disabled = true;

    const typingIndicator = createTypingIndicator();

    try {
        // Переводим промпт если нужно
        let apiText = text;
        if (translateCheckbox.checked) {
            apiText = await withTimeout(
                translateText(text, 'en'),
                API_TIMEOUT,
                'Превышено время ожидания перевода'
            );
        }

        const stylePrompt = `${styleSelect.value}, ${apiText}`;

        const headers = {
            "Authorization": `Bearer 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`,
            "Content-Type": "application/json"
        };

        const response = await withTimeout(
            fetch("https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0", {
                method: "POST",
                headers: headers,
                body: JSON.stringify({ 
                    inputs: stylePrompt,
                    parameters: {
                        width: 1024,
                        height: 1024
                    }
                })
            }),
            API_TIMEOUT,
            'Превышено время ожидания генерации изображения'
        );

        if (!response.ok) {
            throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);

        removeTypingIndicator(typingIndicator);
        const imageHtml = `
            <div style="text-align: center;">
                <img src="${imageUrl}" style="max-width: 90%; max-height: 70vh; border-radius: 10px; margin: 10px 0;">
                <div style="margin-top: 5px; font-size: 0.9em; color: #666;">${stylePrompt}</div>
            </div>
        `;
        appendMessage(imageHtml, "bot");
        saveChatHistory(imageHtml, "bot");
    } catch (error) {
        console.error("Ошибка генерации изображения:", error);
        removeTypingIndicator(typingIndicator);
        appendMessage(`Ошибка при генерации изображения: ${error.message}`, "bot");
    } finally {
        userInput.disabled = false;
        generateImageButton.disabled = false;
        userInput.focus();
    }
}

window.onload = function () {
    loadUserAvatar();
    loadChatHistory();
};

userInput.addEventListener('keydown', function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault(); 
        sendMessage();
    }
});

sendButton.addEventListener('click', sendMessage);
generateImageButton.addEventListener('click', generateImage);