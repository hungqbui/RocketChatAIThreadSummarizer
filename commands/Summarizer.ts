import { IHttp, IModify, IPersistence, IRead } from "@rocket.chat/apps-engine/definition/accessors";
import { RocketChatAssociationRecord, RocketChatAssociationModel } from "@rocket.chat/apps-engine/definition/metadata";
import { SlashCommandContext, ISlashCommand } from "@rocket.chat/apps-engine/definition/slashcommands";

type ThreadCache = {
    summary: string;
    numOfMSGs: number;
}


export class Summarizer implements ISlashCommand {
    public command = "summarize";
    public i18nParamsExample = "";
    public i18nDescription = "";
    public providesPreview = false;

    private async summarizeText(text: string, http: IHttp): Promise<string> {
        const headers = {
            "Content-Type": "application/json",
        }
        
        const prompt = `You are a summarizer bot for a chat server. You need to summarize dialogues in a concise and include noteworthy details. The dialogue is as follows:\n\n${text}`

        const payload = {
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }]
        }
        
        try {
            
            const response = await http.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=<GEMINI_API_KEY>", {
                headers: headers,
                data: payload,
            })

            return JSON.parse(response.content!).candidates[0].content.parts[0].text

        } catch (error) {
            throw error
        }
    }

    public async executor(context: SlashCommandContext, read: IRead, modify: IModify, http: IHttp, persis: IPersistence): Promise<void> {

        
        const room = context.getRoom();
        const sender = await read.getUserReader().getById("aisummarizer.bot");
        
        const message = modify.getCreator().startMessage({
            room: room,
            sender: sender,
        });

        const threadId = context.getThreadId();

        if (!threadId) {
            message.setText("Please use this command in a thread");
            modify.getCreator().finish(message);

            return;
        }

        message.setThreadId(threadId);

        const threadReader = read.getThreadReader();
        const thread = await threadReader.getThreadById(threadId);

        if (!thread) {
            message.setText("Thread not found");
            modify.getCreator().finish(message);

            return;
        }

        thread.shift();
        const threadAssociation = new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, threadId)
        const persistentReader = read.getPersistenceReader()

        const cache = await persistentReader.readByAssociation(threadAssociation)

        const args = context.getArguments();
        
        let res = "";
        let humanMessages = 0;

        for (const msg of thread) {
            if (msg.sender.username === "aisummarizer.bot") continue;
            res += `${msg.sender.username} at ${msg.createdAt}: ${msg.text}\n`;
            humanMessages++;
        }
        
        const foundCache = cache[0] || undefined;

        if (args[0] != "regen" && foundCache && foundCache["numOfMSGs"] === humanMessages) {
            message.setText(foundCache["summary"]);
            modify.getCreator().finish(message);

            return;
        }

        const summary =  await this.summarizeText(res, http);

        let cacheString = ""
        cache.forEach((obj) => { cacheString += JSON.stringify(obj) })

        
        const currentLog = {
            summary: summary,
            numOfMSGs: humanMessages
        }
        
        await persis.updateByAssociation(threadAssociation, currentLog, true)
        
        message.setText(summary);

        modify.getCreator().finish(message);
    }
}