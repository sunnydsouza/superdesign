import * as vscode from 'vscode';
import { ClaudeCodeService } from '../services/claudeCodeService';
import { ChatMessageService } from '../services/chatMessageService';
import { generateWebviewHtml } from '../templates/webviewTemplate';
import { WebviewContext } from '../types/context';
import { AgentService } from '../types/agent';

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly VIEW_TYPE = 'superdesign.chatView';
    private _view?: vscode.WebviewView;
    private messageHandler: ChatMessageService;
    private customMessageHandler?: (message: any) => void;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly agentService: AgentService,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.messageHandler = new ChatMessageService(agentService, outputChannel);
    }

    public setMessageHandler(handler: (message: any) => void) {
        this.customMessageHandler = handler;
    }

    public sendMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'src', 'assets')
            ]
        };

        const webviewContext: WebviewContext = {
            layout: 'sidebar',
            extensionUri: this._extensionUri.toString()
        };

        webviewView.webview.html = generateWebviewHtml(
            webviewView.webview,
            this._extensionUri,
            webviewContext
        );

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                // First try custom message handler for auto-canvas functionality
                if (this.customMessageHandler) {
                    this.customMessageHandler(message);
                }

                // Then handle regular chat messages
                switch (message.command) {
                    case 'chatMessage':
                        await this.messageHandler.handleChatMessage(message, webviewView.webview);
                        break;
                    case 'stopChat':
                        await this.messageHandler.stopCurrentChat(webviewView.webview);
                        break;
                    case 'executeAction':
                        // Execute command from error action buttons
                        console.log('Executing action:', message.actionCommand, message.actionArgs);
                        if (message.actionArgs) {
                            await vscode.commands.executeCommand(message.actionCommand, message.actionArgs);
                        } else {
                            await vscode.commands.executeCommand(message.actionCommand);
                        }
                        break;
                    case 'getBase64Image':
                        // Forward to extension for image conversion
                        // This will be handled by extension.ts
                        break;
                    case 'getCurrentProvider':
                        await this.handleGetCurrentProvider(webviewView.webview);
                        break;
                    case 'changeProvider':
                        await this.handleChangeProvider(message.model, webviewView.webview);
                        break;
                }
            }
        );
    }

    private async handleGetCurrentProvider(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('superdesign');
        const currentProvider = config.get<string>('aiModelProvider', 'openai');
        const currentModel = config.get<string>('aiModel');

        // If no specific model is set, use defaults
        let defaultModel: string;
        switch (currentProvider) {
            case 'openrouter':
                defaultModel = 'anthropic/claude-3-7-sonnet-20250219';
                break;
            case 'anthropic':
                defaultModel = 'claude-3-5-sonnet-20241022';
                break;
            case 'gemini':
                defaultModel = 'gemini-2.5-pro';
                break;
            case 'claude-code':
                defaultModel = 'claude-code';
                break;
            case 'openai':
            default:
                defaultModel = 'gpt-5';
                break;
        }
        
        webview.postMessage({
            command: 'currentProviderResponse',
            provider: currentProvider,
            model: currentModel || defaultModel
        });
    }

    private async handleChangeProvider(model: string, webview: vscode.Webview) {
        try {
            const config = vscode.workspace.getConfiguration('superdesign');
            
            // Determine provider and API key based on model
            let provider: string;
            let apiKeyKey: string;
            let configureCommand: string;
            let displayName: string;

            if (model.includes('/')) {
                provider = 'openrouter';
                apiKeyKey = 'openrouterApiKey';
                configureCommand = 'superdesign.configureOpenRouterApiKey';
                displayName = `OpenRouter (${this.getModelDisplayName(model)})`;
            } else if (model.startsWith('claude-')) {
                provider = 'anthropic';
                apiKeyKey = 'anthropicApiKey';
                configureCommand = 'superdesign.configureApiKey';
                displayName = `Anthropic (${this.getModelDisplayName(model)})`;
            } else if (model.startsWith('gemini-')) {
                provider = 'gemini';
                apiKeyKey = 'geminiApiKey';
                configureCommand = 'superdesign.configureGeminiApiKey';
                displayName = `Google Gemini (${this.getModelDisplayName(model)})`;
            } else {
                provider = 'openai';
                apiKeyKey = 'openaiApiKey';
                configureCommand = 'superdesign.configureOpenAIApiKey';
                displayName = `OpenAI (${this.getModelDisplayName(model)})`;
            }
            
            // Update both provider and specific model
            await config.update('aiModelProvider', provider, vscode.ConfigurationTarget.Global);
            await config.update('aiModel', model, vscode.ConfigurationTarget.Global);
            
            // Check if the API key is configured for the selected provider
            const apiKey = config.get<string>(apiKeyKey);
            
            if (!apiKey) {
                const result = await vscode.window.showWarningMessage(
                    `${displayName} selected, but API key is not configured. Would you like to configure it now?`,
                    'Configure API Key',
                    'Later'
                );
                
                if (result === 'Configure API Key') {
                    await vscode.commands.executeCommand(configureCommand);
                }
            }

            // Notify webview of successful change
            webview.postMessage({
                command: 'providerChanged',
                provider: provider,
                model: model
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update AI model: ${error}`);
        }
    }
    
    private getModelDisplayName(model: string): string {
        const modelNames: { [key: string]: string } = {
            // OpenAI models
            'gpt-5': 'GPT-5',
            'gpt-5-codex': 'GPT-5 Codex',
            'gpt-5-mini': 'GPT-5 Mini',
            'gpt-4.1': 'GPT-4.1',
            'gpt-4.1-mini': 'GPT-4.1 Mini',
            'gpt-4.1-nano': 'GPT-4.1 Nano',
            'gpt-4o': 'GPT-4o',
            'gpt-4o-mini': 'GPT-4o Mini',
            // Anthropic direct
            'claude-4-opus-20250514': 'Claude 4 Opus',
            'claude-4-sonnet-20250514': 'Claude 4 Sonnet',
            'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
            'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
            // Gemini models
            'gemini-2.5-pro': 'Gemini 2.5 Pro',
            'gemini-2.5-flash': 'Gemini 2.5 Flash',
            // OpenRouter models
            'anthropic/claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet (OpenRouter)',
            'google/gemini-2.5-pro': 'Gemini 2.5 Pro (OpenRouter)',
            'meta-llama/llama-4-maverick-17b-128e-instruct': 'Llama 4 Maverick 17B (OpenRouter)',
            'deepseek/deepseek-r1': 'DeepSeek R1 (OpenRouter)',
            'mistralai/mistral-small-3.2-24b-instruct-2506': 'Mistral Small 3.2 24B (OpenRouter)',
            'x-ai/grok-3': 'Grok 3 (OpenRouter)',
            'qwen/qwen3-235b-a22b-04-28': 'Qwen3 235B (OpenRouter)',
            'perplexity/sonar-reasoning-pro': 'Sonar Reasoning Pro (OpenRouter)',
            'microsoft/phi-4-reasoning-plus-04-30': 'Phi-4 Reasoning Plus (OpenRouter)',
            'nvidia/llama-3.3-nemotron-super-49b-v1': 'Llama 3.3 Nemotron Super 49B (OpenRouter)',
            'cohere/command-a-03-2025': 'Command A (OpenRouter)',
            'amazon/nova-pro-v1': 'Nova Pro (OpenRouter)',
            'inflection/inflection-3-productivity': 'Inflection 3 Productivity (OpenRouter)',
            'rekaai/reka-flash-3': 'Reka Flash 3 (OpenRouter)',
            'x-ai/grok-code-fast-1': 'Grok Code Fast 1 (OpenRouter)',
            'anthropic/claude-sonnet-4': 'Claude Sonnet 4 (OpenRouter)',
            'deepseek/deepseek-chat-v3.1:free': 'DeepSeek Chat V3.1 Free (OpenRouter)'
        };

        return modelNames[model] || model;
    }
}