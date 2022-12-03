import { Patcher, WebpackModules } from "@zlibrary";
import BasePlugin from "@zlibrary/plugin";

const attachmentClass: string = WebpackModules.getByProps('attachment', 'filenameLinkWrapper').attachment;
const imageWrapperClass: string = WebpackModules.getByProps('imageWrapper').imageWrapper;
const linkClass: string = WebpackModules.getByProps('anchorUnderlineOnHover').anchorUnderlineOnHover;
const codeEmbedClass: string = WebpackModules.getByProps('attachmentContentItem').attachmentContentItem;
const messageContentClass: string = WebpackModules.getByProps('markup').markup;
const downloadSectionClass: string = WebpackModules.getByProps('downloadSection').downloadSection;

const IMAGE_TYPES = ['jfif', 'webp', 'bmp', 'tiff', 'psd', 'svg', 'ico', 'heic', 'heif', 'avif', 'apng'];
const VIDEO_TYPES = ['mp4', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mkv', 'mpg', 'mpeg', 'm4v', '3gp', '3g2', 'ogv', 'gifv'];
const AUDIO_TYPES = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'alac', 'amr', 'ape', 'au', 'dct', 'dss', 'dvf', 'gsm', 'iklax', 'ivs', 'mogg', 'mpc', 'msv', 'nmf', 'nsf', 'oga', 'opus', 'ra', 'raw', 'sln', 'tta', 'vox', 'wv', 'weba', '8svx'];

const transformAttachmentFromHref = (href: string) => {
	if(!href) return;
	const ext = extractFileExt(href);
	if(IMAGE_TYPES.includes(ext)) { return createFakeImageEmbed(href); }
	if(VIDEO_TYPES.includes(ext)) { return createFakeVideoEmbed(href); }
	if(AUDIO_TYPES.includes(ext)) { return createFakeAudioEmbed(href); }
}

const createFakeImageEmbed = (href: string) => {
	const wrapper = document.createElement('div');
	wrapper.setAttribute('class', imageWrapperClass);
	const img = document.createElement('img');
	img.setAttribute('class', imageWrapperClass);
	img.src = href;
	img.setAttribute('style', 'max-width: 400px; width: 100%;');
	wrapper.appendChild(img);
	return wrapper;
}

const createFakeVideoEmbed = (href: string) => {
	const wrapper = document.createElement('div');
	wrapper.setAttribute('class', codeEmbedClass);
	const vid = document.createElement('video');
	vid.controls = true;
	const source = document.createElement('source');
	source.src = href;
	vid.appendChild(source);
	wrapper.appendChild(vid);
	return wrapper;
}

const createFakeAudioEmbed = (href: string) => {
	const ret = document.createElement('div');
	const audio = document.createElement('audio');
	audio.controls = true;
	const source = document.createElement('source');
	source.src = href;
	audio.appendChild(source);
	ret.appendChild(audio);
	return ret;
}

const extractFileExt = (url: string) => {
	const fileNameSplit = extractFileName(url).split('.');
	if (fileNameSplit.length == 1) return undefined;
	return fileNameSplit.pop().toLowerCase();
}

const extractFileName = (url: string) => url.split('/').pop();

const elementHandler = (node: Element, selector: string, replacerFn: (elem: Element) => Element) => {
	const elements = Array.from(node.querySelectorAll(selector));
	for(var i = 0; i < elements.length; i++) {
		const element = elements[i];
		const replacement = replacerFn(element);
		if(replacement) {
			element.replaceWith(replacement);
		}
	}
}

const fmtSelector = (classNames: string[]) => {
	return classNames.map(c => 
		c.split(' ').map(cl => `.${cl}`).join('')
	).join(' ');
}

export default class FixFailedEmbeds extends BasePlugin {
	observer({addedNodes, removedNodes}) {
		for(const node of addedNodes) {
			if(node.nodeType === Node.TEXT_NODE) continue;
			elementHandler(node, fmtSelector([attachmentClass]), (elem) => {
				const l: HTMLLinkElement = elem?.children[2] as HTMLLinkElement;
				return transformAttachmentFromHref(l?.href);
			});
			elementHandler(node, fmtSelector([messageContentClass, linkClass]), (elem) => {
				const href = elem.getAttribute('href');
				return transformAttachmentFromHref(href);
			});
			elementHandler(node, fmtSelector([codeEmbedClass]), (elem) => {
				let e: HTMLLinkElement = elem.querySelector(`a${fmtSelector([downloadSectionClass])}`);
				return transformAttachmentFromHref(e?.href);
			});
		}
	}
}