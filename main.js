const simpleGit = require('simple-git');
const { exec } = require('child_process');
const schedule = require('node-schedule');
const moment = require('moment');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const fs = require('fs');
const UTF8_BOM = "\u{FEFF}";

dotenv.config();

const mailConfig = {
  host: process.env.MAIL_HOST,
  service: process.env.MAIL_SERVICE,
  port: process.env.MAIL_PORT,
  user: process.env.MAIL_USER,
  pass: process.env.MAIL_PASS,
  from: process.env.MAIL_FROM,
  to: 'dev@sysprocard.com.br',
  cc: [''],
};

const mailer = nodemailer.createTransport({
  host: mailConfig.host,
  service: mailConfig.service,
  port: mailConfig.port,
  secure: false,
  auth: {
    user: mailConfig.user,
    pass: mailConfig.pass,
  },
});

async function notify(message, repoName) {
  await mailer.sendMail({
    to: mailConfig.to,
    from: `SYSPROCARD <${mailConfig.from}>`,
    html: message,
    subject: `SYSPRO PIPELINE - ${repoName}`,
    cc: mailConfig.cc,
  });
}

schedule.scheduleJob('*/1 * * * *', async () => {
  await main();
});

async function main(){
  let json = fs.readFileSync('./config.json', 'utf8');

  if (json.startsWith(UTF8_BOM)) {
    json = json.substring(UTF8_BOM.length);
  }

  const configs = JSON.parse(json);
  const repos = configs.repos;

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const git = simpleGit(repo.src);
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      await initRepo(git, repo);
    }

    const isOriginChanged = await verifyOriginChanges(git, repo);

    if (isOriginChanged || repo.forceUpdate || !isRepo) {
      const initBuildDate = moment();

      await notify(`Build Started ${repo.forceUpdate ? 'FORCED' : ''} - ${repo['project-name']} ${moment().format('DD/MM/yyyy HH:mm:ss')}`, repo['project-name']);

      await configRepo(repo, async (err, stdout, stderr) => {
        if (err) {
          await notify(`Build Finished - ${repo['project-name']} ${moment().format('DD/MM/yyyy HH:mm:ss')}<br>Error`, repo['project-name']);
          return console.log('err', err);
        }

        if (stderr) {
          await notify(`Build Finished - ${repo['project-name']} ${moment().format('DD/MM/yyyy HH:mm:ss')}<br>Error`, repo['project-name']);
          return console.log('stderr', stderr);
        }

        const finBuildDate = moment();
        const duration = moment.duration(finBuildDate.diff(initBuildDate));
        const minutes = duration.asMinutes();
        const seconds = duration.asSeconds();
        const durationFormatted = minutes < 1 ? `${seconds.toFixed(2)}s` : `${minutes.toFixed(2)}}m`;

        await notify(`Build Finished - ${repo['project-name']} ${moment().format('DD/MM/yyyy HH:mm:ss')}<br>Success Duration ${durationFormatted}`, repo['project-name']);
      });
    } else {
      // console.log('Nothing changed here', repo['project-name']);
    }
  }
}

async function initRepo(git, config) {
  try {
    console.log('Cloning repo...');

    await git.init();
    await git.addRemote('origin', config.repoURL);
    await git.pull('origin', config.trackBranch);
    await git.checkout(`origin/${config.trackBranch}`);

    console.log('Cloned successfully');
  } catch(err) {
    console.log(err);
  }
}

async function verifyOriginChanges(git, config) {
  try {
    const currentLocalId = await git.revparse(['HEAD']);

    await git.pull('origin', config.trackBranch);

    const newLocalId = await git.revparse(['HEAD']);

    if (currentLocalId !== newLocalId) return true;

    return false;
  } catch(err) {
    console.log(err);
  }
}

async function configRepo(config, callback) {
  exec(`cd ${config.src} && npm install && npm run build`, callback);
}
