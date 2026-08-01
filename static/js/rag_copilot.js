/**
 * FALCONZ AI Copilot — RAG Assistant Module
 * Handles floating chat drawer, user queries, quick preset chips, and telemetry citations.
 */

document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        btnToggle: document.getElementById('btn-rag-copilot-toggle'),
        drawer: document.getElementById('rag-copilot-drawer'),
        btnClose: document.getElementById('btn-rag-copilot-close'),
        chatLogs: document.getElementById('rag-chat-logs'),
        input: document.getElementById('rag-chat-input'),
        btnSend: document.getElementById('btn-rag-send'),
        presetChips: document.querySelectorAll('.rag-preset-chip')
    };

    if (!elements.drawer) return;

    // Toggle Drawer Open / Close
    function toggleDrawer(show = null) {
        if (show === true) {
            elements.drawer.classList.add('open');
        } else if (show === false) {
            elements.drawer.classList.remove('open');
        } else {
            elements.drawer.classList.toggle('open');
        }

        if (elements.drawer.classList.contains('open') && elements.input) {
            setTimeout(() => elements.input.focus(), 150);
        }
    }

    if (elements.btnToggle) {
        elements.btnToggle.addEventListener('click', () => toggleDrawer());
    }

    if (elements.btnClose) {
        elements.btnClose.addEventListener('click', () => toggleDrawer(false));
    }

    // Keyboard Shortcut (Ctrl + K) to toggle Copilot
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            toggleDrawer();
        }
    });

    // Append User or Assistant Message
    function appendMessage(text, sender = 'bot', metadata = null) {
        if (!elements.chatLogs) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = `rag-msg rag-msg-${sender}`;

        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        if (sender === 'user') {
            msgDiv.innerHTML = `
                <div class="rag-msg-bubble rag-user-bubble">
                    <div class="rag-msg-header">
                        <span class="rag-msg-author">YOU</span>
                        <span class="rag-msg-time">${timestamp}</span>
                    </div>
                    <div class="rag-msg-text">${escapeHtml(text)}</div>
                </div>
            `;
        } else {
            let alertsHtml = '';
            if (metadata && metadata.alerts && metadata.alerts.length > 0) {
                alertsHtml = '<div class="rag-alerts-group">';
                metadata.alerts.forEach(alertText => {
                    alertsHtml += `<div class="rag-alert-badge">${escapeHtml(alertText)}</div>`;
                });
                alertsHtml += '</div>';
            }

            let sourcesHtml = '';
            if (metadata && metadata.sources && metadata.sources.length > 0) {
                sourcesHtml = '<div class="rag-sources-group"><span class="sources-title">Retrieved Knowledge:</span>';
                metadata.sources.forEach(src => {
                    sourcesHtml += `<span class="rag-source-chip" title="ID: ${src.id}">📚 ${escapeHtml(src.title)}</span>`;
                });
                sourcesHtml += '</div>';
            }

            let formattedText = formatMarkdown(text);

            msgDiv.innerHTML = `
                <div class="rag-msg-bubble rag-bot-bubble">
                    <div class="rag-msg-header">
                        <span class="rag-msg-author">🤖 FALCONZ AI COPILOT</span>
                        <span class="rag-msg-time">${timestamp}</span>
                    </div>
                    ${alertsHtml}
                    <div class="rag-msg-text">${formattedText}</div>
                    ${sourcesHtml}
                </div>
            `;
        }

        elements.chatLogs.appendChild(msgDiv);
        elements.chatLogs.scrollTop = elements.chatLogs.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    }

    function formatMarkdown(str) {
        let clean = escapeHtml(str);
        // Bold
        clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Line breaks
        clean = clean.replace(/\n/g, '<br>');
        return clean;
    }

    // Send Query to Backend RAG API
    async function sendQuery(queryText) {
        const text = queryText || (elements.input ? elements.input.value.trim() : '');
        if (!text) return;

        if (elements.input) elements.input.value = '';

        appendMessage(text, 'user');

        // Show typing indicator
        const typingDiv = document.createElement('div');
        typingDiv.className = 'rag-msg rag-msg-bot rag-typing-indicator';
        typingDiv.innerHTML = `
            <div class="rag-msg-bubble rag-bot-bubble">
                <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                <span style="font-size: 0.75rem; color: #94A3B8; margin-left: 6px;">Retrieving knowledge base & inspecting telemetry...</span>
            </div>
        `;
        elements.chatLogs.appendChild(typingDiv);
        elements.chatLogs.scrollTop = elements.chatLogs.scrollHeight;

        try {
            const res = await fetch('/api/rag/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: text })
            });

            typingDiv.remove();

            if (res.ok) {
                const data = await res.json();
                appendMessage(data.answer, 'bot', data);
            } else {
                appendMessage('Sorry, I encountered an error searching the knowledge base.', 'bot');
            }
        } catch (err) {
            typingDiv.remove();
            appendMessage('Unable to reach FALCONZ AI backend. Check server connection.', 'bot');
        }
    }

    if (elements.btnSend) {
        elements.btnSend.addEventListener('click', () => sendQuery());
    }

    if (elements.input) {
        elements.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendQuery();
            }
        });
    }

    // Preset Prompt Chips Click Event
    elements.presetChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            if (prompt) {
                sendQuery(prompt);
            }
        });
    });
});
