// @ts-ignore
import PostalMime, { Attachment } from 'postal-mime';

let HEADERS = {};

interface PaperlessDocument {
	title: string;
	created?: Date;
	correspondent?: string;
	document_type?: string;
	storage_path?: string;
	tags?: string; // can be specified multiple times, this isn't currently handled
	archive_serial_number?: number;
	custom_fields?: { [key: string]: string };
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		HEADERS = {
			'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
			'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
			Authorization: `Token ${env.PAPERLESS_TOKEN}`,
		};

		const msg = await PostalMime.parse(message.raw);

		for (const attachment of msg.attachments) {
			if (attachment.disposition == 'inline') {
				continue;
			}

			const filename = attachment.filename;
			console.log(`Processing attachment with name ${filename} and mime type ${attachment.mimeType}`);

			const resp = await this.post_document(env, attachment, msg.subject);
			const body = await resp.text();
			if (resp.ok) {
				console.log(`Successfully submitted ${filename} to paperless`);
				console.log(`Response: ${body}`);
			} else {
				console.warn(`Failed to submit: ${filename}`);
				console.warn(`Status: ${resp.status}`);
				console.warn(`Response: ${body}`);
				await message.forward(env.POSTMASTER_EMAIL);
			}
		}
	},

	async post_document(env: Env, attachment: Attachment, subject?: string): Promise<Response> {
		const doc: PaperlessDocument = {
			title: attachment.filename ?? subject ?? 'UNKNOWN', // TODO this better
			tags: env.PAPERLESS_DEFAULT_TAG,
		};

		const formData = new FormData();
		formData.append('document', new Blob([attachment.content]));
		// TODO handle this more better
		formData.append('title', doc.title);
		if (doc.tags) {
			formData.append('tags', doc.tags);
		}

		return await fetch(`${env.PAPERLESS_API_BASE}/documents/post_document/`, {
			headers: HEADERS,
			method: 'POST',
			body: formData,
		});
	},
};
