(function () {
  function clear(root = document) {
    root.querySelectorAll('.question-panel').forEach(panel => panel.remove());
  }

  function isAnswer(questions, text) {
    const choices = questions.flatMap(question => (question.options || []).map(option => typeof option === 'string' ? option : option.label));
    return choices.length ? choices.includes(text.trim()) : true;
  }

  function show(element, questions, submit) {
    if (!element || !Array.isArray(questions) || !questions.length) return;
    clear(element.closest('#messages') || element);
    const panel = document.createElement('form');
    panel.className = 'question-panel';
    const fields = [];
    questions.forEach((question, index) => {
      const field = document.createElement('fieldset');
      const title = document.createElement('legend');
      title.textContent = question.question || question.title || '请选择';
      field.append(title);
      const options = document.createElement('div');
      options.className = 'question-options';
      const selected = { value: '' };
      for (const option of question.options || []) {
        const label = typeof option === 'string' ? option : option.label;
        if (!label) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'question-option';
        button.textContent = label;
        if (typeof option === 'object' && option.description) button.title = option.description;
        button.onclick = () => {
          selected.value = label;
          options.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
          if (questions.length === 1) panel.requestSubmit();
        };
        options.append(button);
      }
      field.append(options);
      const custom = document.createElement('input');
      custom.className = 'question-custom';
      custom.type = question.isSecret ? 'password' : 'text';
      custom.placeholder = '其他回答';
      custom.setAttribute('aria-label', '其他回答');
      custom.oninput = () => { selected.value = ''; options.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', 'false')); };
      field.append(custom);
      panel.append(field);
      fields.push({ id: question.id || String(index), title: title.textContent, selected, custom });
    });
    const send = document.createElement('button');
    send.className = 'question-submit';
    send.type = 'submit';
    send.textContent = '提交回答';
    panel.append(send);
    panel.onsubmit = async event => {
      event.preventDefault();
      const answers = {};
      for (const field of fields) {
        const value = field.custom.value.trim() || field.selected.value;
        if (!value) { field.custom.focus(); return; }
        answers[field.id] = { answers: [value] };
      }
      send.disabled = true;
      try {
        if (await submit(answers, fields)) panel.remove();
      } finally { send.disabled = false; }
    };
    element.append(panel);
  }

  window.PocketQuestions = { clear, isAnswer, show };
})();
