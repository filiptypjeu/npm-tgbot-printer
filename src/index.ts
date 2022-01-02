import { JobTemplateAttributes, MimeMediaType, PrinterDescription, PrinterStatus } from "ipp";
import { IPPPrinter, IPrintJobInfo, IStatus } from "ipp-easyprint";
import { LocalStorage } from "node-localstorage";
import { TGKeyboard } from "tgbot-keyboard";
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

export class TGPrinter extends TGKeyboard {
  // Printer
  public readonly printer: IPPPrinter;

  // Variables
  private readonly userSettings: ObjectVariable<JobTemplateAttributes>;
  public readonly jobNameAt: StringVariable;

  // Available job attributes fetched from the printer
  public availableJobAttributes: IStatus = {};

  // XXX: Change to one options object
  /**
   * @param name Printer name.
   * @param printerURL Printer URL.
   * @param bot node-telegra-bot-api TelegramBot instance.
   * @param ls node-localstorage LocalStorage instance.
   * @param statusAttributes Attributes to fetch when asking for printer status.
   * @param jobAttributes User settable print job attributes.
   * @param tgBotName Telegram bot name.
   * @param keyboardId Short ID for the keyboard.
   */
  constructor(
    public readonly name: string,
    printerURL: string,
    bot: TelegramBot,
    ls: LocalStorage,
    private readonly statusAttributes: Array<keyof PrinterStatus | keyof PrinterDescription>,
    private readonly jobAttributes: Array<keyof JobTemplateAttributes>,
    tgBotName?: string,
    keyboardId: string = "P"
  ) {
    super(keyboardId, bot, ls);

    this.jobNameAt = new StringVariable(`${this.name}JobNameAt`, tgBotName || "TelegramBot", this.ls);
    this.userSettings = new ObjectVariable<JobTemplateAttributes>(`${this.name}UserSettings`, {}, this.ls);

    // Create printer and fetch available job attributes
    this.printer = new IPPPrinter(printerURL);
  }

  /**
   * Fetch available print job attributes from the printer and store them.
   */
  public async load(): Promise<IStatus> {
    return this.printer
      .printerStatus(
        this.jobAttributes
          .map((s: string) => s + (s === "media" ? "-ready" : "-supported"))
          .concat(this.jobAttributes.map(s => s + "-default")) as any
      )
      .then(status => {
        this.availableJobAttributes = status;
        const d: any = {};
        this.jobAttributes.forEach(s => { d[s] = status[s + "-default" as keyof IStatus]; });
        this.userSettings.defaultValue = d;
        return status;
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
  public beep(): Promise<boolean> {
    return this.printer.identify();
  }

  /**
   * Send a document behind a URL as a print job to the printer.
   */
  public async printURL(url: string, user: TelegramBot.User): Promise<string> {
    const buffer = await this.urlToBuffer(url);

    const jobName = url.split("#")[0].split("?")[0].split("/").reverse()[0].trim() || url;

    const username = this.username(user);

    const options: IPrintJobInfo = {
      buffer,
      jobName,
      username,
    };

    return this.printer.printFile(options).then(() => {
      const name = `${username}/${jobName}`;
      return name;
    });
  }

  /**
   * Send a document from Telegram as a print job to the printer.
   */
  public async printDocument(document: TelegramBot.Document, user: TelegramBot.User): Promise<string> {
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

    return this.printer.printFile(options).then(() => {
      const name = `${username}/${jobName}`;
      return name;
    });
  }

  /**
   * Crete a Telegram keyboard based on the print job attributes given in the constructor. The keyboard has two levels: Choose attribute on the first level, and set the attribute value on the second level.
   *
   * @param attribute Which second level keyboard to create.
   */
  public keyboard(_chat_id: ChatID, attribute?: keyof JobTemplateAttributes): TelegramBot.InlineKeyboardButton[][] {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    if (!attribute) {
      this.jobAttributes.forEach(key => keyboard.push([{ text: key, callback_data: this.toCallbackData(CallbackType.GoTo, key) }]));

      keyboard.push([
        { text: "Exit", callback_data: this.toCallbackData(CallbackType.Exit) },
        { text: "Clear all", callback_data: this.toCallbackData(CallbackType.ClearAll) },
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
        const values = this.availableJobAttributes[(attribute + (attribute === "media" ? "-ready" : "-supported")) as keyof IStatus];
        if (values && Array.isArray(values)) {
          values.forEach(v =>
            keyboard.push([
              {
                text: typeof v === "string" ? v : JSON.stringify(v),
                callback_data: this.toCallbackData(CallbackType.SetValueAndBack, attribute, v),
              },
            ])
          );
        }
      }

      keyboard.push([
        {
          text: "Back",
          callback_data: this.toCallbackData(CallbackType.Back),
        },
        {
          text: "Default",
          callback_data: this.toCallbackData(
            CallbackType.SetValue,
            attribute,
            this.availableJobAttributes[(attribute + "-default") as keyof IStatus]
          ),
        },
      ]);
    }

    return keyboard;
  }

  private toCallbackData(callbackType: CallbackType, attribute?: keyof JobTemplateAttributes, data?: any): string {
    return this.ccd(`${callbackType}:${attribute || ""}:${typeof data === "undefined" ? "" : JSON.stringify(data)}`);
  }

  private fromCallbackData(callbackData: CallbackData): ICallbackData {
    const a = callbackData.split(":")[1];
    const d = callbackData.split(":")[2];
    return {
      callbackType: callbackData.split(":")[0] as CallbackType,
      attribute: a ? (a as keyof JobTemplateAttributes) : undefined,
      data: d ? JSON.parse(d) : undefined,
    };
  }

  protected handleCallback(callbackData: string, q: TelegramBot.CallbackQuery): string {
    const info = this.fromCallbackData(callbackData as CallbackData);
    const chat_id = q.message!.chat.id;

    let text = "";

    switch (info.callbackType) {
      case CallbackType.SetValue:
        this.userSettings.setProperty(info.attribute!, info.data, chat_id);
        text = `${info.attribute!} = ${info.data}`;
        break;

      case CallbackType.AddValue:
        text = `${info.attribute!} = ${this.addValue(chat_id, info.attribute!, info.data)}`;
        break;

      case CallbackType.SetValueAndBack:
        this.userSettings.setProperty(info.attribute!, info.data, chat_id);
        text = `${info.attribute!} = ${info.data}`;
        this.editKeyboard(chat_id);
        break;

      case CallbackType.Back:
        this.editKeyboard(chat_id);
        break;

      case CallbackType.GoTo:
        this.editKeyboard(chat_id, this.keyboard(chat_id, info.attribute));
        break;

      case CallbackType.ClearAll:
        text = "All printer settings removed";
        this.userSettings.reset(chat_id);
        break;

      case CallbackType.Exit:
        this.removeKeyboard(chat_id, this.settingsToString(chat_id));
        break;
    }

    return text;
  }

  private addValue(chat_id: ChatID, property: keyof JobTemplateAttributes, add: string): number {
    const prop = this.userSettings.getProperty(property, chat_id);
    const oldValue = typeof prop === "number" ? prop : 1;
    const newValue = oldValue + (Number(add) || 0);
    this.userSettings.setProperty(property, newValue, chat_id);
    return newValue;
  }

  private settingsToString(chat_id: ChatID): string {
    return `<b>${this.name} printer settings</b>\n<code>${JSON.stringify(this.userSettings.get(chat_id), null, 2)}</code>`;
  }

  private username(user: TelegramBot.User): string {
    return `${user.username || [user.first_name, user.last_name].join("_")}@${this.jobNameAt.get()}`;
  }

  private async urlToBuffer(url: string): Promise<Buffer> {
    const u = new URL(url);

    if (!u.pathname.split("/").reverse()[0].includes(".")) {
      return Promise.reject(`URL ${url} is not a file that can be printed`);
    }

    return fetch(u.href)
      .then(res => res.buffer())
      .catch(e => Promise.reject(e));
  }
}
