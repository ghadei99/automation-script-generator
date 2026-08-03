const FRAMEWORKS = ['selenium', 'cypress', 'playwright'];

function renderAll(actions) {
  const renderers = {
    selenium: window.CodeGen.renderSelenium,
    cypress: window.CodeGen.renderCypress,
    playwright: window.CodeGen.renderPlaywright,
  };
  for (const fw of FRAMEWORKS) {
    const code = actions.length ? renderers[fw](actions) : '// No code saved yet.';
    document.getElementById(`codeBox-${fw}`).value = code;
  }
}

function setActiveFramework(framework) {
  for (const fw of FRAMEWORKS) {
    document.getElementById(`panel-${fw}`).classList.toggle('active', fw === framework);
  }
  document.querySelectorAll('#tabStrip button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.framework === framework);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const frameworkSelect = document.getElementById('frameworkSelect');
  const tabStrip = document.getElementById('tabStrip');

  const updateCodeBoxes = () => {
    chrome.storage.local.get('recordedActions', (result) => {
      renderAll(result.recordedActions || []);
    });
  };

  const applyFrameworkChoice = () => {
    const choice = frameworkSelect.value;
    if (choice === 'all') {
      tabStrip.classList.add('visible');
      const activeTab = tabStrip.querySelector('button.active') || tabStrip.querySelector('button');
      setActiveFramework(activeTab.dataset.framework);
    } else {
      tabStrip.classList.remove('visible');
      setActiveFramework(choice);
    }
  };

  frameworkSelect.addEventListener('change', applyFrameworkChoice);

  tabStrip.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setActiveFramework(btn.dataset.framework));
  });

  document.getElementById('copyButton').addEventListener('click', () => {
    const activeTextarea = document.querySelector('.code-panel.active textarea');
    navigator.clipboard.writeText(activeTextarea.value).then(() => {
      alert('Copied to clipboard!');
    }).catch((err) => {
      console.error('Failed to copy text: ', err);
    });
  });

  document.getElementById('clearButton').addEventListener('click', () => {
    chrome.storage.local.set({ recordedActions: [] });
  });

  updateCodeBoxes();
  applyFrameworkChoice();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.recordedActions) {
      updateCodeBoxes();
    }
  });
});
