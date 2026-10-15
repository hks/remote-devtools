import {defineConfig} from 'vitepress';

// Project pages are served from https://<user>.github.io/<repo>/; DOCS_BASE overrides it (e.g. "/" for a custom domain).
const base = process.env.DOCS_BASE ?? '/remote-devtools/';
const repo = 'https://github.com/hks/remote-devtools';

export default defineConfig({
    title: 'Remote DevTools',
    description: 'Inspect and control your app from your computer: logs, network, state, storage, flags and custom panels.',
    base,
    cleanUrls: true,
    lastUpdated: true,
    srcExclude: ['internal/**', 'scripts/**', 'README.md'],
    head: [['link', {rel: 'icon', href: `${base}favicon.svg`}]],
    themeConfig: {
        logo: '/favicon.svg',
        nav: [
            {text: 'Guide', link: '/guide/introduction'},
            {text: 'Modules', link: '/modules/logs'},
            {text: 'Reference', link: '/reference/sdk'},
        ],
        sidebar: [
            {
                text: 'Getting started',
                items: [
                    {text: 'Introduction', link: '/guide/introduction'},
                    {text: 'Quick start: web', link: '/guide/quick-start-web'},
                    {text: 'Quick start: React Native / Expo', link: '/guide/quick-start-react-native'},
                    {text: 'Connecting devices', link: '/guide/connecting'},
                ],
            },
            {
                text: 'Running the relay',
                items: [
                    {text: 'Desktop app (macOS)', link: '/guide/desktop-app'},
                    {text: 'Self-hosting with Docker', link: '/guide/self-hosting'},
                    {text: 'Security', link: '/guide/security'},
                ],
            },
            {
                text: 'Modules',
                items: [
                    {text: 'Logs', link: '/modules/logs'},
                    {text: 'Network', link: '/modules/network'},
                    {text: 'Functions', link: '/modules/functions'},
                    {text: 'Storage', link: '/modules/storage'},
                    {text: 'State', link: '/modules/state'},
                    {text: 'Flags', link: '/modules/flags'},
                    {text: 'Custom panels', link: '/modules/panels'},
                    {text: 'Writing a module', link: '/modules/custom-modules'},
                ],
            },
            {
                text: 'Reference',
                items: [
                    {text: 'JS SDK', link: '/reference/sdk'},
                    {text: 'Field DSL', link: '/reference/field-dsl'},
                    {text: 'Protocol', link: '/reference/protocol'},
                    {text: 'Writing an SDK', link: '/reference/write-an-sdk'},
                ],
            },
            {
                text: 'Contributing',
                items: [
                    {text: 'Development setup', link: '/maintainers/development'},
                    {text: 'Releasing', link: '/maintainers/releasing'},
                    {text: 'macOS signing', link: '/maintainers/macos-release'},
                ],
            },
        ],
        socialLinks: [{icon: 'github', link: repo}],
        editLink: {pattern: `${repo}/edit/main/docs/:path`},
        search: {provider: 'local'},
        footer: {message: 'Released under the MIT License.'},
    },
});
