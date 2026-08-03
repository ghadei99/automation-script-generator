const FRAMEWORKS = ['selenium', 'cypress', 'playwright'];
const SECTIONS = ['ui', 'api'];

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

function renderApiCalls(apiCalls) {
  const code = apiCalls.length ? window.CodeGen.renderRestAssured(apiCalls) : '// No API calls captured yet.';
  document.getElementById('codeBox-restassured').value = code;
}

function setActiveFramework(framework) {
  for (const fw of FRAMEWORKS) {
    document.getElementById(`panel-${fw}`).classList.toggle('active', fw === framework);
  }
  document.querySelectorAll('#tabStrip button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.framework === framework);
  });
}

function setActiveSection(section) {
  for (const s of SECTIONS) {
    document.getElementById(`section-${s}`).classList.toggle('active', s === section);
  }
  document.querySelectorAll('#sectionTabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const frameworkSelect = document.getElementById('frameworkSelect');
  const tabStrip = document.getElementById('tabStrip');
  const sectionTabs = document.getElementById('sectionTabs');

  const updateCodeBoxes = () => {
    chrome.storage.local.get(['recordedActions', 'recordedApiCalls'], (result) => {
      renderAll(result.recordedActions || []);
      renderApiCalls(result.recordedApiCalls || []);
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

  sectionTabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setActiveSection(btn.dataset.section));
  });

  document.getElementById('copyButton').addEventListener('click', () => {
    const activeTextarea = document.querySelector('.section.active .code-panel.active textarea');
    navigator.clipboard.writeText(activeTextarea.value).then(() => {
      alert('Copied to clipboard!');
    }).catch((err) => {
      console.error('Failed to copy text: ', err);
    });
  });

  document.getElementById('clearButton').addEventListener('click', () => {
    chrome.storage.local.set({ recordedActions: [], recordedApiCalls: [] });
  });

  updateCodeBoxes();
  applyFrameworkChoice();
  setActiveSection('ui');

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.recordedActions || changes.recordedApiCalls)) {
      updateCodeBoxes();
    }
  });
});
