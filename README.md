# Selenium Code Generator

This project is a JavaScript-based tool that generates Selenium WebDriver code snippets based on user interactions with a webpage. It listens to various DOM events and dynamically creates corresponding Selenium code for automating browser actions.

## Features

- **Navigate Event**: Generates code for navigating to a new URL.
- **Click Event**: Generates code for clicking elements.
- **Input Event**: Generates code for entering text into input fields.
- **Change Event**: Handles radio buttons and checkboxes.
- **Submit Event**: Generates code for submitting forms.
- **Double Click Event**: Generates code for double-clicking elements.
- **Clipboard Support**: Copy generated code to clipboard.
- **Clear Code**: Clear the generated code.

## How It Works

1. **Event Listeners**: The script listens to DOM events like `click`, `input`, `change`, `submit`, and `dblclick`.
2. **Code Generation**: Based on the event and the target element, it generates corresponding Selenium WebDriver code.
3. **Storage**: The generated code is stored in Chrome's local storage for persistence.
4. **Copy and Clear**: Provides buttons to copy the generated code to the clipboard or clear the code.

## Installation

1. Clone the repository:
  ```bash
  git clone https://github.com/your-username/selenium-code-generator.git
  ```
2. Open the project folder:
  ```bash
  cd selenium-code-generator
  ```
3. Load the extension in Chrome:
  - Open `chrome://extensions/`.
  - Enable "Developer mode".
  - Click "Load unpacked" and select the project folder.

## Usage

1. Open the webpage you want to automate.
2. Perform actions like clicking, typing, or submitting forms.
3. The corresponding Selenium WebDriver code will be generated automatically.
4. Use the "Copy" button to copy the code or "Clear" to reset.

## Example Output
