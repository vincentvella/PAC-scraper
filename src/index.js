//require('dotenv').config();
import '@babel/polyfill';
import axios from 'axios';
import cheerio from 'cheerio';
import firebase from 'firebase/app';
import 'firebase/database';

const config = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.AUTH_DOMAIN,
  databaseURL: process.env.DATABASE_URL,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID,
};

firebase.initializeApp(config);
const db = firebase.database();
const ref = db.ref();

export default class WebScraper {
  static condenseEvents(result, currentScrapedEvents) {
    let condensedEvents = {};
    Object.keys(result).forEach((eventKey) => {
      if (!(currentScrapedEvents && currentScrapedEvents[eventKey])) {
        condensedEvents = {
          ...condensedEvents,
          [eventKey]: result[eventKey],
        };
      }
    });
    return condensedEvents;
  }
  
  constructor(props) {
    this.ref = props.ref;
    this.toHex = this.toHex.bind(this);
    this.runScraper = this.runScraper.bind(this);
    this.makeRequest = this.makeRequest.bind(this);
    this.getScrapedEvents = this.getScrapedEvents.bind(this);
    this.extractListingsFromHTML = this.extractListingsFromHTML.bind(this);
  }
  
  toHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      hex += `${str.charCodeAt(i).toString(16)}`;
    }
    return hex.trim();
  };
  
  extractListingsFromHTML(html) {
    const $ = cheerio.load(html, { xmlMode: false });
    let events = {};
    $('div.twRyoPhotoEventsItemHeader').each((i, el) => {
      events = { ...events, [i]: {} };
      events[i].timeDate = $(el).children('.twRyoPhotoEventsItemHeaderDate').text().trim(); // this is the time and date
      events[i].calendar = $(el).children('.twRyoPhotoEventsItemHeaderLocation').text().trim(); // calendar location
    });
    $('span.twRyoPhotoEventsDescription').each((i, el) => {
      events[i].title = $(el).children('a').text().trim();
    });
    $('div.twRyoPhotoEventsNotes').each((i, el) => {
      $(el).children('p').each((j, detail) => {
        if ($(detail).text() === 'More details...') {
          events[i].extraInfoLink = $(detail).children('a').attr('href');
        }
      });
      events[i].details = $(el).html();
    });
    let finalEvents = {};
    Object.keys(events).forEach((key) => {
      const event = events[key];
      const eventKey = this.toHex(event.timeDate + event.title);
      finalEvents = { ...finalEvents, [eventKey]: event };
    });
    return finalEvents;
  };
  
  async getScrapedEvents() {
    const snapshot = await this.ref.child('/Scraped-Events').once('value');
    return snapshot.val();
  }
  
  async makeRequest(i, j, year) {
    let listings = {};
    try {
      //The web request to 25LivePub
      let response = await axios.get(`https://25livepub.collegenet.com/calendars/arts-and-architecture-mixin?date=${year}${i < 10 ? `0${i}` : i}${j < 10 ? `0${j}` : j}&media=print`, { headers: { 'content-type': 'text/html' } });
      if (response.status === 200) {
        const html = response.data;
        listings = { ...listings, ...this.extractListingsFromHTML(html) };
      }
      return listings;
    } catch (err) {
      console.warn('REQUEST ERROR:', `date=${year}${i < 10 ? `0${i}` : i}${j < 10 ? `0${j}` : j}`);
    }
  }
  
  async runScraper(year) {
    const dateVariables = [];
    for (let i = 1; i < 13; i++) {
      for (let j = 1; j < 31; j++) {
        dateVariables.push({ i, j, year });
      }
    }
    let result = {};
    let currentScrapedEvents = {};
    try {
      const val = await Promise.all(
        dateVariables.map(async date => this.makeRequest(date.i, date.j, date.year)),
      );
      val.forEach((requestGroup) => {
        Object.keys(requestGroup).forEach((eventKey) => {
          result = { ...result, [eventKey]: requestGroup[eventKey] };
        });
      });
      currentScrapedEvents = await this.getScrapedEvents();
    } catch (err) {
      console.warn('ERROR Condensing request')
    }
    return { ...WebScraper.condenseEvents(result, currentScrapedEvents) };
  }
  
  async startScraper() {
    let year = 0;
    let date = new Date();
    let years = [date.getFullYear(), date.getFullYear() + 1];
    const run = async () => {
      if (year === 0) {
        year ++;
      } else {
        year --;
      }
      let events = await this.runScraper(years[year]);
      console.log('Events', Object.keys(events).length);
      setTimeout(() => {
        run().then(() => {
          console.log('DATE', years[year], new Date().toISOString());
        });
      }, 1000 * 60 * 30);
    };
    run().then(() => {
      console.log('DATE', years[year], new Date().toISOString());
    });
  }
  
  async init() {
    console.log('INITIALIZING');
    this.startScraper();
    return this;
  }
}

const webScraper = new WebScraper({ref});
webScraper.init();
setTimeout(() => process.exit(), 86400000);