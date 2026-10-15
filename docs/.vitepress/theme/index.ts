import type {Theme} from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import LandingPage from './LandingPage.vue';

// The default theme everywhere; the home page (`layout: false`) renders the standalone <LandingPage/>.
export default {
    extends: DefaultTheme,
    enhanceApp({app}) {
        app.component('LandingPage', LandingPage);
    },
} satisfies Theme;
