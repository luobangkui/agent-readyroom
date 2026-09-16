export function handleMessageKeydown(event,{canSend,send}){
  if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.shiftKey||event.altKey)return false;
  event.preventDefault();
  if(canSend&&!event.repeat)send();
  return true;
}
