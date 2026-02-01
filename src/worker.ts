// @ts-ignore
import PostalMime, { Attachment } from 'postal-mime';

let HEADERS = {};

// Parse plus addressing tags from email (e.g., docs+nunc+tax@example.com → ['nunc', 'tax'])
function parsePlusAddressTags(email: string): string[] {
	const localPart = email.split('@')[0];
	const plusIndex = localPart.indexOf('+');
	if (plusIndex === -1) return [];
	const tagPart = localPart.slice(plusIndex + 1);
	return tagPart.split('+').map((t) => t.toLowerCase()).filter((t) => t.length > 0);
}

// Map plus-address tags to group IDs for permissions
const TAG_GROUP_MAP: Record<string, number> = {
	'nunc': 6,
};

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

interface PaperlessTag {
	id: number;
	name: string;
}

async function fetchTags(env: Env): Promise<Map<string, number>> {
	const response = await fetch(`${env.PAPERLESS_API_BASE}/tags/`, {
		headers: HEADERS,
		method: 'GET',
	});

	if (!response.ok) {
		console.warn(`Failed to fetch tags: ${response.status}`);
		return new Map();
	}

	const data = await response.json() as { results: PaperlessTag[] };
	const tagMap = new Map<string, number>();

	for (const tag of data.results) {
		tagMap.set(tag.name.toLowerCase(), tag.id);
	}

	return tagMap;
}

function parseHashtags(subject: string): { tags: string[]; cleanedSubject: string } {
	const hashtagRegex = /#(\w+)/g;
	const tags: string[] = [];
	let match;

	while ((match = hashtagRegex.exec(subject)) !== null) {
		tags.push(match[1].toLowerCase());
	}

	const cleanedSubject = subject.replace(hashtagRegex, '').trim();

	return { tags, cleanedSubject };
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		HEADERS = {
			'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
			'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
			Authorization: `Token ${env.PAPERLESS_TOKEN}`,
		};

		const msg = await PostalMime.parse(message.raw);
		const ignoredMimeTypes = env.IGNORED_MIME_TYPES ? env.IGNORED_MIME_TYPES.split(',').map((t) => t.trim()) : [];

		// Debug logging
		console.log(`Email parsed: subject="${msg.subject}", attachments count=${msg.attachments.length}`);
		msg.attachments.forEach((att, idx) => {
			console.log(`Attachment ${idx}: filename="${att.filename}", mimeType="${att.mimeType}", disposition="${att.disposition}", size=${att.content?.byteLength || 0}`);
		});

		// Fetch tag map from Paperless API
		const tagMap = await fetchTags(env);

		for (const attachment of msg.attachments) {
			// Skip ignored MIME types first
			if (ignoredMimeTypes.includes(attachment.mimeType)) {
				console.log(`Skipping attachment ${attachment.filename} with ignored MIME type ${attachment.mimeType}`);
				continue;
			}

			// Skip inline attachments, but allow PDFs and other document types even if inline
			const documentMimeTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
			if (attachment.disposition == 'inline' && !documentMimeTypes.includes(attachment.mimeType)) {
				console.log(`Skipping inline attachment ${attachment.filename} with MIME type ${attachment.mimeType}`);
				continue;
			}

			const filename = attachment.filename;
			console.log(`Processing attachment with name ${filename} and mime type ${attachment.mimeType}`);

			const resp = await this.post_document(env, attachment, msg.subject, tagMap, message.to);
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

	async post_document(env: Env, attachment: Attachment, subject: string | undefined, tagMap: Map<string, number>, recipient: string): Promise<Response> {
		// Parse hashtags from subject
		const { tags: hashtagNames, cleanedSubject } = subject ? parseHashtags(subject) : { tags: [], cleanedSubject: '' };

		// Determine title: cleaned subject or filename
		const title = cleanedSubject || attachment.filename || 'UNKNOWN';

		// Build tag ID list
		const tagIds: number[] = [];

		// Always add forced tag if set
		if (env.PAPERLESS_FORCED_TAG) {
			const forcedTagId = parseInt(env.PAPERLESS_FORCED_TAG);
			if (!isNaN(forcedTagId)) {
				tagIds.push(forcedTagId);
			}
		}

		// Add tags from plus addressing (e.g., docs+nunc+tax@example.com)
		const plusTags = parsePlusAddressTags(recipient);
		for (const tagName of plusTags) {
			const tagId = tagMap.get(tagName);
			if (tagId) {
				tagIds.push(tagId);
				console.log(`Applied plus-address tag "${tagName}" (ID: ${tagId}) from ${recipient}`);
			} else {
				console.warn(`Plus-address tag "${tagName}" not found in Paperless`);
			}
		}

		// Add hashtag tags if found, otherwise use default tag
		if (hashtagNames.length > 0) {
			for (const tagName of hashtagNames) {
				const tagId = tagMap.get(tagName);
				if (tagId) {
					tagIds.push(tagId);
				} else {
					console.warn(`Tag "${tagName}" not found in Paperless`);
				}
			}
		} else if (env.PAPERLESS_DEFAULT_TAG) {
			const defaultTagId = parseInt(env.PAPERLESS_DEFAULT_TAG);
			if (!isNaN(defaultTagId)) {
				tagIds.push(defaultTagId);
			}
		}

		const doc: PaperlessDocument = {
			title,
			tags: tagIds.length > 0 ? tagIds.join(',') : undefined,
		};

		// Build group permissions from plus-address tags
		const groupIds: number[] = [];
		for (const tagName of plusTags) {
			const groupId = TAG_GROUP_MAP[tagName];
			if (groupId) {
				groupIds.push(groupId);
			}
		}

		const formData = new FormData();
		formData.append('document', new Blob([attachment.content]));
		formData.append('title', doc.title);
		if (doc.tags) {
			formData.append('tags', doc.tags);
		}
		if (groupIds.length > 0) {
			const permissions = {
				view: { users: [3], groups: groupIds },
				change: { users: [3], groups: groupIds },
			};
			formData.append('set_permissions', JSON.stringify(permissions));
			console.log(`Setting permissions for user 3 and groups: ${groupIds.join(', ')}`);
		}

		console.log(`Uploading document: title="${title}", tags="${doc.tags}"`);

		return await fetch(`${env.PAPERLESS_API_BASE}/documents/post_document/`, {
			headers: HEADERS,
			method: 'POST',
			body: formData,
		});
	},
};
