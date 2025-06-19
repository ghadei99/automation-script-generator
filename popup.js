
document.addEventListener("DOMContentLoaded", () => {
  const updateCodeBox = () => {
    chrome.storage.local.get("seleniumCode", (result) => {
      const code = result.seleniumCode;
      console.log("Code retrieved from storage:", code);
      document.getElementById("codeBox").value = code
        ? Array.isArray(code)
          ? code.join("\n")
          : code
        : "// No code saved yet.";
    });
  };

  // Initial load
  updateCodeBox();

  // Listen for changes in storage
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.seleniumCode) {
      updateCodeBox();
    }
  });
});