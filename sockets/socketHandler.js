const socketHandler = {
  initSocketServer: (io) => {
    io.on('connection', (socket) => {
      console.log(`[Socket] User connected: ${socket.id}`);

      socket.on('update-location', (data) => {
        console.log(`[Socket] Location updated by ${socket.id}:`, data);
        socket.broadcast.emit('location-updated', {
          mechanicId: data.mechanicId,
          location: data.location,
        });
      });

      socket.on('send-message', (data) => {
        console.log(`[Socket] Message from ${socket.id}:`, data);
        socket.broadcast.emit('new-message', data);
      });

      socket.on('request-accepted', (data) => {
        console.log(`[Socket] Request accepted by ${socket.id}:`, data);
        socket.broadcast.emit('request-matched', data);
      });

      socket.on('status-update', (data) => {
        console.log(`[Socket] Status updated by ${socket.id}:`, data);
        socket.broadcast.emit('status-changed', data);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
      });
    });
  },
};

module.exports = socketHandler;
