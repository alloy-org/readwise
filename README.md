# Yappy

Yappy is an [Amplenote plugin](https://www.amplenote.com/help/developing_amplenote_plugins) that implements 
AI functionality desired by its author. 

Initially, Yappy was developed only within its note in Amplenote, but there were a few benefits to extracting 
it to this git repo:

* When its syntax is incorrect, the IDE can highlight specifically *where* it's wrong
* It can be tested with unit tests
* It will allow GitClear to track how it evolves over time
* It can be used as a template for other Amplenote plugins?

So here we are.

## Installation

1. Clone this repo. `git clone git@github.com:alloy-org/yappy.git`
2. Install node and npm if you haven't already. 
3. Run `npm install` to install the packages.  
4. Copy `.env.example` to `.env` and fill in the environment variable for your OpenAI key

## Testing

Run `NODE_OPTIONS=--experimental-vm-modules npm test` to run the tests.

### Run tests continuously as modifying the plugin

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test -- --watch
```

## Technologies used to help with this project

* https://esbuild.github.io/getting-started/#your-first-bundle
* https://jestjs.io/
* https://www.gitclear.com
