const log = logger.withScope('errorHandler')
const { isNpm } = require('is-npm')
const Sentry = require('@sentry/node')

const bannedErrors = [
  'Token/username/password not found.', // incorrect config
  'Missing Permissions', // incorrect Discord permissions
  'Incorrect login details were provided.', // incorrect Discord token
  'Invalid username or email address', // incorrect Facebook credentials
  'Invalid username or password', // incorrect Facebook credentials
  'User must verify their account', // Facebook login review
  'Service temporarily unavailable', // Facebook is down
  'ECONNRESET', // connection reset
  'Missing Permissions', // Discord missing permissions
  'MQTT connection failed' // Facebook MQTT connection fail
]
const isErrorBanned = error => bannedErrors.some(banned => error.toString().includes(banned))
const errorDescriptions = {
  'Invalid username or email address': `
Couldn't login to Facebook.
Check your username/email address, it may be incorrect.
`,
  'Invalid username or password': `
Couldn't login to Facebook.
Check your password or preferrably, use an app password:
http://facebook.com/settings?tab=security&section=per_app_passwords&view
`,
  'Incorrect login details were provided.': `
Couldn't login to Discord.
Check your token.
(it shouldn't be client ID nor anything else that doesn't have "token" in its name)
`
}
const getErrorDescription = error => Object.keys(errorDescriptions).find(desc => error.toString().includes(desc))

const dataPath = process.env.DATA_PATH !== 'undefined' ? process.env.DATA_PATH : undefined

module.exports = async error => {
  if (!(error instanceof Error)) {
    if (typeof error === 'string') error = new Error(error)
    if (error.err || error.error) {
      let err = error.err || error.error
      if (err instanceof Error) {
        error = err
      }
    }
  }
  const exitCode = error.requestArgs ? 'close 1' : 'close 2'
  log.error(error)
  if (!isErrorBanned(error)) Sentry.captureException(error)

  const desc = getErrorDescription(error)
  if (desc) log.error(desc[1])

  if (isNpm) {
    log.warn(`Logs from NPM are unnecessary and don't give much information.
Miscord logs folder:
${dataPath || require('../lib/config/getConfigDir')()}/logs`)
  }

  if (global.discord && discord.channels && discord.channels.error) {
    try {
      let errorMessage = error instanceof Error
        ? `${error.message}\n${error.stack}`
        : typeof error !== 'string' ? JSON.stringify(error) : error
      if (errorMessage.length >= 1900) {
        for (let i = 0; i < errorMessage.length; i += 1900) {
          await discord.channels.error.send(errorMessage.substring(i, i + 1900), { code: true })
        }
      } else {
        await discord.channels.error.send(errorMessage, { code: true })
      }
    } catch (err) {
      log.fatal(err)
      Sentry.captureException(err)
    } finally {
      await Sentry.getCurrentHub().getClient().close(2000)
      await discord.client.destroy()
      console.error(exitCode)
    }
  } else {
    await Sentry.getCurrentHub().getClient().close(2000)
    if (global.discord) await discord.client.destroy()
    console.error(exitCode)
  }
}
module.exports.initSentry = () => {
  const pkg = require('../package.json')
  Sentry.init({
    dsn: 'https://832ace0158714146b8bd3ee3ac1e45bb@sentry.miscord.net/2',
    maxBreadcrumbs: 0, // important, as it shows console messages
    release: `miscord@${pkg.version}`
  })
  Sentry.configureScope(scope => {
    scope.setTag('is_packaged', Boolean(process.pkg).toString().toLowerCase())
    scope.setTag('platform', require('os').platform())
    scope.setTag('version', pkg.version)
    scope.setTag('node_version', process.version)
  })
}
