function getSessionID() {
    const today = new Date();
    return today.toISOString().substring(0, 10).replace(/-/g, '');
  }
  
  module.exports = {
    getSessionID,
  };
  