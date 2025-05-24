# 🧠 CoDebugger.ai


An AI-powered debugging assistant for **VS Code** that identifies optimal debugging points, analyzes code execution, and provides intelligent insights to help you solve issues faster.

---

## ✨ Features

- **Smart Breakpoint Placement**: Automatically identifies and sets breakpoints at critical locations
- **Runtime Insight Analysis**: Provides AI-driven insights during debugging sessions
- **Variable Analysis**: Explains variable behavior and detects anomalies
- **Root Cause Detection**: Intelligently identifies potential causes of bugs
- **Fix Suggestions**: Offers potential solutions for identified issues
- **Interactive Debugging**: Ask questions about variables during debugging sessions

---

## 🛠️ Installation

1. Open **Visual Studio Code**
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"CoDebugger.ai"**
4. Click **Install**

---

## ⚙️ Configuration

### 🔑 API Key Setup

The extension requires an API key from your preferred AI provider (OpenAI, Anthropic, or Google).

#### Option 1: Using `config.ts` (Recommended)

Create or edit the file at `src/config.ts`:

```
/**
 * Configuration file for API keys
 * DO NOT COMMIT THIS FILE TO VERSION CONTROL
 */

export const API_KEYS = {
    OPENAI: 'your-openai-api-key-here',
    ANTHROPIC: '', // Your Anthropic key if needed
    GOOGLE: '',    // Your Google key if needed
};
```

✅ **Be sure to add `src/config.ts` to your `.gitignore`.**

---

### Option 2: Using VS Code Command Palette

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type and select: **"Intelligent Debugger: Set API Key Manually"**
3. Choose your LLM provider and enter the API key

---

### Option 3: Using VS Code Settings UI

1. Go to Settings (`Ctrl+,` / `Cmd+,`)
2. Search for **"Intelligent Debugger"**
3. Enter your API key in the **"LLM API Key"** field
4. Select your preferred **LLM Provider**

---

### 🔧 Additional Settings

| Setting              | Description                                              | Default           |
|----------------------|----------------------------------------------------------|-------------------|
| **LLM Provider**      | Select AI provider (OpenAI, Anthropic, Google, Local)   | `OpenAI`          |
| **LLM Model**         | AI model to use                                          | `gpt-3.5-turbo`   |
| **Max Breakpoints**   | Max number of intelligent breakpoints                   | `10`              |
| **Enable AI Analysis**| Turn AI-powered analysis on/off                         | `on`              |
| **Local LLM Endpoint**| URL for local LLM server if using "local" option        | *(empty)*         |

---

## 🚀 Usage

### 🔍 Basic Workflow

1. Open your **JavaScript/TypeScript** project in **VS Code**
2. Run **"Start Intelligent Code Analysis"** from the Command Palette
3. The extension will analyze your code and set intelligent breakpoints
4. Start debugging as usual
5. Review AI-generated insights in the **AI Debugger** panel

---

### 💬 Ask About Variables

While paused at a breakpoint:

- **Option 1**: Right-click a variable in the editor → *"Ask About Selected Variable"*
- **Option 2**: Click the **"Ask About Any Variable"** button in the debug toolbar

The AI will provide detailed explanations in the output panel.

---

### 📊 View Debug Insights

Click the **AI Debugger** icon in the Activity Bar to explore:

- **Intelligent Breakpoints**: Where and why breakpoints were placed
- **Debug Insights**: Runtime insights and anomaly detection
- **Root Cause Analysis**: Potential causes of issues
- **Fix Suggestions**: AI-suggested solutions

---

## ⌨️ Key Commands

| Command                          | Description                                       |
|----------------------------------|---------------------------------------------------|
| Start Intelligent Code Analysis  | Analyze code and set intelligent breakpoints      |
| View Debug Insights              | Open the debug insights panel                     |
| Ask About Selected Variable      | Ask about the currently selected variable         |
| Ask About Any Variable           | Choose a variable to question                     |
| Set Custom Debug Prompt          | Create a custom debugging prompt                  |
| Set API Key Manually             | Configure API key via UI                          |
| Start Intelligent Debugging      | Begin debugging with AI assistance                |

---

## 🧬 Technical Details

The extension leverages advanced techniques:

- **Static Code Analysis**: Builds a code flow graph to find critical points
- **Runtime Data Collection**: Captures variable values & execution context
- **AI-Powered Analysis**: Uses LLMs to understand code and behavior
- **Anomaly Detection**: Detects unusual patterns in variable values or logic
- **Causal Analysis**: Infers potential causes of bugs

---

## 🧯 Troubleshooting

### ❗ API Key Issues

- Ensure your key is set in `src/config.ts` or VS Code settings
- Confirm the correct LLM provider is selected
- Retry using the manual command: **Set API Key Manually**
- Verify API access to the model (especially for OpenAI)

### 🐢 Performance Issues

- Reduce **Max Breakpoints** in settings
- Use a faster model like **gpt-3.5-turbo**
- Analyze specific files instead of the whole project

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📄 License

This extension is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.

---

## 👨‍💻 Credits

Developed by **Yashwanth Nandam**
