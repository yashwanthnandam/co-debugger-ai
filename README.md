# 🧠 CoDebugger.ai

**AI-powered debugging assistant for VS Code** that identifies optimal debugging points, recursively analyzes variables, and provides intelligent insights to help you solve issues faster.

---

## ✨ Features

- **Smart Breakpoint Placement**: Automatically sets breakpoints at key locations based on your debugging goal  
- **Deep Variable Analysis**: Recursively explores nested objects and identifies critical patterns  
- **Intelligent Debugging Questions**: Auto-generates relevant questions based on variable state  
- **Runtime Insight Analysis**: Provides AI-generated insights during debugging sessions  
- **Categorized Variable Insights**: Organizes variables by importance and diagnostic value  
- **Root Cause Detection**: Intelligently identifies potential causes of bugs  
- **Fix Suggestions**: Offers potential solutions to identified issues  
- **Interactive Debugging**: Ask questions about variables during active debugging  
- **Multiple AI Providers**: Supports OpenAI, Anthropic, Google, and local LLMs  

---

## 🛠️ Installation

1. Open **Visual Studio Code**  
2. Go to **Extensions** (Ctrl+Shift+X / Cmd+Shift+X)  
3. Search for `CoDebugger.ai`  
4. Click **Install**

---

## ⚙️ Configuration

### 🔑 AI Provider Setup

You can configure AI access in one of three ways:

#### Option 1: Configuration Wizard (Recommended)

- Click the `Configure AI` button in the status bar  
- Follow the 4-step wizard:
  1. Select AI provider (OpenAI, Anthropic, Google, Local)
  2. Enter your API key
  3. Choose your preferred model
  4. Set additional parameters (e.g., temperature)

#### Option 2: Manual Configuration

Create or edit the file: `src/config.ts`

```
/**
 * Configuration file for API keys
 * DO NOT COMMIT THIS FILE TO VERSION CONTROL
 */
export const API_KEYS = {
    OPENAI: 'your-openai-api-key-here',
    ANTHROPIC: '', // Your Anthropic key
    GOOGLE: '',    // Your Google key
};
```

# 🧠 CoDebugger.ai

**AI-powered debugging assistant for VS Code** that identifies optimal debugging points, recursively analyzes variables, and provides intelligent insights to help you solve issues faster.

---

## ✅ Configuration Note

Make sure `src/config.ts` is listed in `.gitignore`.

---

## ⚙️ Option 3: VS Code Settings

1. Open **Settings** (`Ctrl+,` / `Cmd+,`)
2. Search for **Intelligent Debugger**
3. Enter your **AI provider** and **API key**

---

## 🔧 Available Settings

| Setting             | Description                              | Default                      |
|---------------------|------------------------------------------|------------------------------|
| `llmProvider`       | Select AI provider                       | `openai`                     |
| `llmModel`          | AI model to use                          | `gpt-4`                      |
| `temperature`       | Creativity of AI responses (0.0–1.0)     | `0.7`                        |
| `maxTokens`         | Max token count in AI responses          | `2048`                       |
| `maxBreakpoints`    | Max intelligent breakpoints              | `10`                         |
| `recursiveMaxDepth` | Max depth for recursive variable analysis| `3`                          |
| `localLLMEndpoint`  | Local LLM server endpoint (if applicable)| `http://localhost:8080/v1`  |

---

## 🚀 Usage

### 🔍 Basic Workflow

1. Open your **JavaScript/TypeScript** project
2. Click the **Configure AI** button
3. Run **Start Intelligent Code Analysis** from the Command Palette
4. Enter your debugging goal (e.g., `"user authentication"`)

The extension will:

- Analyze your code  
- Set intelligent breakpoints  
- Provide runtime insights  

Then:

- Start debugging  
- View insights in the **Debug Insights** panel


### 🔎 Deep Variable Analysis

When you hit a breakpoint, CoDebugger.ai will:

- Recursively analyze nested objects and arrays  
- Categorize insights by type (Error Conditions, User Data, State Values, etc.)  
- Generate debugging questions based on variable patterns  
- Highlight anomalies in deeply nested properties  

---

### 💬 Ask About Variables

While paused at a breakpoint:

- Right-click a variable → **Ask About Selected Variable**  
- OR click **Ask About Any Variable** in the debug toolbar  
- OR click on one of the auto-generated debugging questions  

The AI will provide insights on:

- Current value  
- Purpose  
- Behavior  
- Relationships with other variables  

---

### 📊 View Debug Insights

The **Debug Insights Panel** shows:

- **High-Impact Variables**: Most diagnostic variables at breakpoint  
- **Categorized Insights**: Organized by type (Errors, User Data, State, Configuration)  
- **Debugging Questions**: AI-generated questions relevant to your code  
- **Execution Context**: Current call stack and execution path  
- **Nested Property Analysis**: Deep insights from complex objects  

---

### 🎯 Focused Debugging

1. Run **Start Intelligent Debug**  
2. Enter your debugging focus (e.g., `"user validation"`)  
3. The AI will target breakpoints relevant to that area  
4. The Debug Insights panel will highlight variables and patterns related to your focus  

---

## ⌨️ Key Commands

| Command                      | Description                              |
|-----------------------------|------------------------------------------|
| Configure AI Settings       | Set up AI provider                       |
| Start Intelligent Debug     | Begin a focused debugging session        |
| View Debug Insights         | Open the insights panel                  |
| Ask About Selected Variable | Ask AI about selected variable           |
| Ask About Variable Pattern  | Ask about a pattern in nested data       |
| Set Custom Debug Prompt     | Set a prompt at the current line         |
| Start Intelligent Analysis  | Analyze and set intelligent breakpoints  |
| Test Debugging Session      | Run a test debugging flow                |

---

## 🧬 Technical Details

This extension uses advanced techniques:

- **Static Code Analysis**: Builds flow graphs  
- **Recursive Variable Analysis**: Traverses complex objects and arrays  
- **Pattern Recognition**: Identifies important variable relationships  
- **Anomaly Detection**: Detects unusual logic or values  
- **Causal Analysis**: Traces potential causes of bugs  
- **Information Gain Optimization**: Places breakpoints strategically  
- **Question Generation**: Creates relevant debugging questions based on data patterns  

---

## 🧯 Troubleshooting

### ❗ API Key Issues

- Check the status bar to verify active config  
- Use the configuration wizard if needed  
- Confirm access to your AI provider (e.g., OpenAI)  
- For local LLMs, ensure your server is up and reachable  

### 🐢 Performance Tips

- Use faster models like `gpt-3.5-turbo`  
- Limit recursive analysis depth (in settings)  
- Focus debugging on specific files or functions  
- Filter variable categories in the UI for faster rendering  

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for more info.

---

## 📄 License

Licensed under the [MIT License](./LICENSE).

---

## 👨‍💻 Credits

Developed by **Yashwanth Nandam**

---

*Last updated: 2025-05-26*
