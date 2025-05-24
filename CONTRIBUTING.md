# Contributing to CoDebugger.ai

Thank you for your interest in contributing to the CoDebugger.ai extension! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

git clone https://github.com/your-username/intelligent-debugger.git cd intelligent-debugger



3. **Install Dependencies**
```
npm install
```

4. **Create a Configuration File**
- Create a `src/config.ts` file with your API keys (see README.md)
- Ensure this file is in your `.gitignore`

5. **Build the Extension**
```
npm run compile
```

## Development Workflow

1. **Create a Branch**
```
git checkout -b feature/your-feature-name
```

2. **Make Your Changes**
- Write code that follows the project's style and conventions
- Add comments where necessary
- Update documentation if needed

3. **Test Your Changes**
- Press F5 in VS Code to launch a new window with your extension loaded
- Verify that your changes work as expected
- Ensure no regressions were introduced

4. **Commit Your Changes**
```
git commit -m "Description of the changes"
```

5. **Push to Your Fork**
```
git push origin feature/your-feature-name
```


6. **Create a Pull Request**
- Go to the original repository on GitHub
- Create a new Pull Request from your branch
- Provide a clear description of the changes and any related issues

## Pull Request Guidelines

- **One feature per PR**: Keep your changes focused on a single feature or bug fix
- **Write clear commit messages**: Describe what you changed and why
- **Update documentation**: Make sure the README and other docs are updated
- **Add tests**: For new features, add appropriate tests
- **Follow code style**: Match the existing code style of the project

## Code Style and Conventions

- Use TypeScript features when possible
- Follow the existing project structure
- Use 4 spaces for indentation
- Use async/await for asynchronous code
- Write clear comments for complex logic

## Adding New Features

When proposing a new feature:

1. First create an issue describing the feature
2. Discuss the feature with the maintainers
3. Once approved, implement the feature
4. Include documentation for the new feature

## Debugging Tips

- Use `console.log` statements for debugging
- Check the "Output" panel in VS Code and select "Intelligent Debugger" for extension logs
- Use the VS Code debugger to debug the extension itself

## Reporting Issues

If you find a bug or have a suggestion:

1. Check if the issue already exists in the GitHub issue tracker
2. If not, create a new issue with:
- A clear title and description
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Any relevant logs or screenshots

## Reviewing Pull Requests

We appreciate help reviewing pull requests:

- Check that the code works as expected
- Look for potential bugs or edge cases
- Verify that documentation is updated
- Ensure tests pass
- Provide constructive feedback

Thank you for contributing to the CoDebugger.ai extension!