# SmartDoc Frontend (my-app)

React app created with Create React App and configured for deployment on Vercel. All backend calls use environment variables via `src/config.js`.

## Environment variables

Configure these in a local `.env` (for local runs) and in Vercel Project Settings → Environment Variables:

- `REACT_APP_API_URL` — Base URL for Node/Express API (e.g., https://api.yourdomain.tld)
- `REACT_APP_PY_API_URL` — Base URL for Python/Flask API (e.g., https://pyapi.yourdomain.tld)

See `.env.example` for a template.

## CORS requirements (backends)

Both APIs must allow the deployed frontend origin:

- `Access-Control-Allow-Origin: https://<your-vercel-domain>.vercel.app`
- `Access-Control-Allow-Headers: Authorization, Content-Type`
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Properly handle `OPTIONS` preflight responses.

## Vercel deployment

1. Push this project to GitHub.
2. In Vercel, import the repo and select `my-app` as the project root if prompted.
3. Set Environment Variables listed above.
4. Build settings:
	- Build Command: `npm run build`
	- Output Directory: `build`
5. Deploy.

## Local development

Create `.env` with your API base URLs, then run:

```bash
npm install
npm start
```

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open http://localhost:3000 to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

For general CRA deployment docs, see https://facebook.github.io/create-react-app/docs/deployment.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
