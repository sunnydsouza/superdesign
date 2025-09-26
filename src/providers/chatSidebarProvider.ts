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
            case 'openai':
                defaultModel = 'gpt-5';
                break;
            case 'openrouter':
                defaultModel = 'google/gemini-2.5-pro';
                break;
            case 'anthropic':
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
                // OpenRouter model (contains slash like "google/gemini-2.5-pro")
                provider = 'openrouter';
                apiKeyKey = 'openrouterApiKey';
                configureCommand = 'superdesign.configureOpenRouterApiKey';
                displayName = `OpenRouter (${this.getModelDisplayName(model)})`;
            } else if (model.startsWith('claude-')) {
                provider = 'anthropic';
                apiKeyKey = 'anthropicApiKey';
                configureCommand = 'superdesign.configureApiKey';
                displayName = `Anthropic (${this.getModelDisplayName(model)})`;
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
            'gpt-5-mini': 'GPT-5 Mini',
            // OpenRouter - Google models
            'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
            'google/gemini-2.5-flash': 'Gemini 2.5 Flash'
        };

        return modelNames[model] || model;
    }
} 
