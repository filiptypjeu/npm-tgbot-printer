import { JobTemplateAttributes, MimeMediaType, PrinterDescription, PrinterStatus } from "ipp";
import { IPPPrinter, IPrintJobInfo, IStatus } from "ipp-easyprint";
import { LocalStorage } from "node-localstorage";
import TelegramBot from "node-telegram-bot-api";
import { ChatID, ObjectVariable, StringVariable } from "tgbot-helpers";
import { URL } from "url";
import fetch from "node-fetch";

enum CallbackType {
  SetValue = "A",
  SetValueAndBack = "B",
  GoTo = "C",
  Back = "D",
  Exit = "E",
  ClearAll = "F",
  AddValue = "G",
}

type CallbackData = `${CallbackType}:${keyof JobTemplateAttributes | ""}:${string}`;

interface ICallbackData {
  callbackType: CallbackType;
  attribute?: keyof JobTemplateAttributes;
  data?: any;
}

export class TGPrinter {
  // Printer name
  public readonly name: string;

  // Printer
  public readonly printer: IPPPrinter;

  // Variables
  public readonly userSettings: ObjectVariable<JobTemplateAttributes>;
  public readonly jobNameAt: StringVariable;

  // Bot and ls
  private readonly bot: TelegramBot;
  private readonly ls: LocalStorage;

  // Attributes to fetch when asking for printer status
  private readonly statusAttributes: Array<keyof PrinterStatus | keyof PrinterDescription>;

  // User settable job attributes
  private readonly jobAttributes: Array<keyof JobTemplateAttributes>;

  // Available job attributes fetched from the printer
  private availableJobAttributes: IStatus = {};

  constructor(printerName: string, printerURL: string, bot: TelegramBot, ls: LocalStorage, statusAttributes: Array<keyof PrinterStatus | keyof PrinterDescription>, jobAttributes: Array<keyof JobTemplateAttributes>, tgBotName: string) {
    this.name = printerName;
    this.bot = bot;
    this.ls = ls;

    this.statusAttributes = statusAttributes;
    this.jobAttributes = jobAttributes;

    this.jobNameAt = new StringVariable(`${this.name}JobNameAt`, tgBotName, this.ls)
    this.userSettings = new ObjectVariable<JobTemplateAttributes>(`${this.name}UserSettings`, {}, this.ls);

    // Create printer and fetch available job attributes
    this.printer = new IPPPrinter(printerURL);
    this.printer.printerStatus(this.jobAttributes.map((s: string) => s + (s === "media" ? "-ready" : "-supported")).concat(this.jobAttributes.map(s => s + "-default")) as any)
      .then(status => this.availableJobAttributes = status)
      .catch(e => console.error(e));

    // Register query callback
    this.bot.on("callback_query", q => {
      console.log("DATA:", q.data);
      const keyboard = this.handleCallback(q);
      if (keyboard) {
        this.bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: q.message?.chat.id, message_id: q.message?.message_id });
      }
    });
  }

  /**
   * Fetch printer status.
   */
  public status(): Promise<IStatus> {
    return this.printer.printerStatus(this.statusAttributes.length ? this.statusAttributes : "all");
  }

  /**
   * Command the printer to identify itself by beeping.
   */
  public beep(): void {
    this.printer.identify();
  }

  /**
   * Send a document behind a URL as a print job to the printer.
   */
  public async printURL (url: string, user: TelegramBot.User): Promise<string> {
    const buffer = await this.urlToBuffer(url);

    const jobName = url
      .split("#")[0]
      .split("?")[0]
      .split("/")
      .reverse()[0]
      .trim() || url;

    const username = this.username(user);

    const options: IPrintJobInfo = {
      buffer,
      jobName,
      username,
    };

    return this.printer.printFile(options).then(() => `${username}/${jobName}`);
  };

  /**
   * Send a document from Telegram as a print job to the printer.
   */
  public async printDocument (document: TelegramBot.Document, user: TelegramBot.User): Promise<string> {
    const fileId = document.file_id;

    const url = await this.bot.getFileLink(fileId);
    const buffer = await this.urlToBuffer(url);

    const jobName = document.file_name || fileId;
    const username = this.username(user);

    const options: IPrintJobInfo = {
      buffer,
      fileType: document.mime_type as MimeMediaType,
      jobName,
      username,
      jobAttributes: this.userSettings.get(user.id),
    };
  
    return this.printer.printFile(options).then(() => `${username}/${jobName}`);
  };

  /**
   * Crete a Telegram keyboard based on the print job attributes given in the constructor. The keyboard has two levels: Choose attribute on the first level, and set the attribute value on the second level.
   *
   * @param attribute Which second level keyboard to create.
   */
  public keyboard(attribute?: keyof JobTemplateAttributes): TelegramBot.InlineKeyboardButton[][] {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    if (!attribute) {
      this.jobAttributes.forEach(key => keyboard.push([
        { text: key, callback_data: this.toCallbackData(CallbackType.GoTo, key), }
      ]));

      keyboard.push([
        { text: "Avsluta", callback_data: this.toCallbackData(CallbackType.Exit), },
        { text: "Rensa allt", callback_data: this.toCallbackData(CallbackType.ClearAll), },
      ]);

    } else {
      if (attribute === "copies") {
        [1, 5, 10].forEach(i =>
          keyboard.push([
            {
              text: i.toString(),
              callback_data: this.toCallbackData(CallbackType.SetValue, "copies", i),
            },
          ])
        );
        [1, 5, 10, -1].forEach(i =>
          keyboard.push([
            {
              text: i > 0 ? `+${i}` : i.toString(),
              callback_data: this.toCallbackData(CallbackType.AddValue, "copies", i),
            },
          ])
        );
      } else {
        const values: string[] = this.availableJobAttributes[(attribute + (attribute === "media" ? "-ready" : "-supported")) as keyof IStatus];
        if (values) {
          values.forEach(v =>
            keyboard.push([
              {
                text: v,
                callback_data: this.toCallbackData(CallbackType.SetValueAndBack, attribute, v),
              },
            ])
          );
        }
      }

      keyboard.push([
        {
          text: "Tillbaka",
          callback_data: this.toCallbackData(CallbackType.Back),
        },
        {
          text: "Default",
          callback_data: this.toCallbackData(CallbackType.SetValue, attribute, this.availableJobAttributes[(attribute + "-default") as keyof IStatus]),
        },
      ]);
    }

    return keyboard;
  };

  private toCallbackData(callbackType: CallbackType, attribute?: keyof JobTemplateAttributes, data?: any): CallbackData {
    return `${callbackType}:${attribute || ""}:${typeof data === "undefined" ? "" : JSON.stringify(data)}`;
  }

  private fromCallbackData(callbackData: CallbackData): ICallbackData {
    const a = callbackData.split(":")[1];
    const d = callbackData.split(":")[2];
    return {
      callbackType: callbackData.split(":")[0] as CallbackType,
      attribute: a ? a as keyof JobTemplateAttributes : undefined,
      data: d ? JSON.parse(d) : undefined,
    }
  }

  private handleCallback(q: TelegramBot.CallbackQuery): TelegramBot.InlineKeyboardButton[][] | undefined {
    if (!q.data || !q.message) {
      return;
    }

    const info = this.fromCallbackData(q.data as CallbackData);
    const chat_id = q.message.chat.id;

    let text = "";
    let keyboard: TelegramBot.InlineKeyboardButton[][] | undefined;

    switch (info.callbackType) {
      case CallbackType.SetValue:
        this.userSettings.setProperty(info.attribute!, info.data, chat_id);
        text = `${info.attribute} = ${info.data}`;
        break;

      case CallbackType.AddValue:
        text =  `${info.attribute} = ${this.addValue(chat_id, info.attribute!, info.data)}`;
        break;

      case CallbackType.SetValueAndBack:
        this.userSettings.setProperty(info.attribute!, info.data, chat_id);
        text = `${info.attribute} = ${info.data}`;
        keyboard = this.keyboard();
        break;

      case CallbackType.Back:
        keyboard = this.keyboard();
        break;

      case CallbackType.GoTo:
        keyboard = this.keyboard(info.attribute);
        break;

      case CallbackType.ClearAll:
        text = "All print settings removed";
        this.userSettings.reset(chat_id);
        break;

      case CallbackType.Exit:
        this.bot.editMessageText(this.settingsToString(chat_id), { chat_id, message_id: q.message.message_id, parse_mode: "HTML" });
        break;
    }

    this.bot.answerCallbackQuery(q.id, { text });
    return keyboard;
  }

  private addValue(chatId: ChatID, property: keyof JobTemplateAttributes, add: string): number {
    const oldValue = this.userSettings.getProperty(property, chatId);
    let newValue: number;
    if (typeof oldValue === "number") {
      newValue = oldValue + (Number(add) || 0); 
    } else {
      newValue = 1;
    }

    this.userSettings.setProperty(property, newValue, chatId);
    return newValue;
  };

  private settingsToString(chatId: ChatID): string {
    return `<b>${this.name} printer settings</b>\n<code>${JSON.stringify(this.userSettings.get(chatId), null, 2)}</code>`;
  };

  private username(user: TelegramBot.User): string {
    return `${user.username || [user.first_name, user.last_name].join("_")}@${this.jobNameAt.get()}`;
  };

  private async urlToBuffer(url: string): Promise<Buffer> {
    const u = new URL(url);
    console.log(u);

    if (!u.pathname.split("/").reverse()[0].includes(".")) {
      return Promise.reject(`URL ${url} is not a file that can be printed`);
    }

    return fetch(u.href)
      .then(res => res.buffer())
      .catch(e => Promise.reject(e));
  };
}
